/**
 * 宿主事件接线。
 *
 * 三处锚点，各有依据：
 *   agent/created     会话开始时注入库上下文（不是 agent/session-start——0.2.2 没有这个事件）
 *   agent/pre-step    任务级召回；先调用 next() 再补充，不打断宿主决策
 *   tools/pre-execute 写入治理；fs/*-intent 只表达版本守卫，没有拒绝语义，硬拦截只能走这里
 */
import { join } from 'node:path'
import type { PkoConfig } from './config.ts'
import { resolveVault } from './vault.ts'
import { userNotice } from './notice.ts'
import { ensureSkills } from './skills.ts'
import { sessionContext, taskContext } from '../../core/src/context.ts'
import { checkBash, checkWrite, normalizeRel } from '../../core/src/policy.ts'
import { existsSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { readIfExists } from '../../core/src/store.ts'
import { vaultPaths } from '../../core/src/paths.ts'

/** 宿主上下文里本插件用到的最小面。 */
export interface EventHost {
  on(event: string, handler: (...args: never[]) => unknown): unknown
  logger?: { info?(message: string): void; warn?(message: string): void }
}

/** 注入用的最小 agent 面。 */
interface AgentLike {
  inject?(message: unknown): void
  session?: { header?: { cwd?: unknown } }
}

/** 会话目录。 */
function cwdOf(agent: AgentLike | undefined): string {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : process.cwd()
}

/** 从 pre-step 决策里尽力取出本步的用户原文。 */
function decisionText(decision: unknown): string {
  const record = decision as { messages?: unknown[] } | null
  const messages = record?.messages
  if (!Array.isArray(messages)) return ''
  const parts: string[] = []
  for (const message of messages) {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') { parts.push(content); continue }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const text = (block as { text?: unknown }).text
      if (typeof block === 'object' && block !== null && typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

/** 判断路径是否在 vault 内，并返回相对路径。 */
function relInsideVault(vault: string, path: string): string | undefined {
  const abs = resolve(path)
  const rel = relative(vault, abs)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) return undefined
  return rel.split(sep).join('/')
}

/**
 * 注册全部事件监听。
 * @param ctx 宿主上下文
 * @param config 插件配置
 * @returns 释放函数（宿主会随插件卸载自动清理，这里只做对称收尾）
 */
export function mountEvents(ctx: EventHost, config: PkoConfig): () => void {
  const offs: Array<() => void> = []
  const lastTask = new WeakMap<object, string>()

  /** 单条注册失败不扩散。 */
  const on = (event: string, handler: (...args: never[]) => unknown): void => {
    try {
      const off = ctx.on(event, handler)
      if (typeof off === 'function') offs.push(off as () => void)
    } catch (error) {
      ctx.logger?.warn?.(`[pko] 订阅 ${event} 失败：${String(error)}`)
    }
  }

  // ---- 会话开始：注入库上下文 ----
  on('agent/created', (async (payload: { agent?: AgentLike }) => {
    const agent = payload?.agent
    if (agent?.inject === undefined) return
    try {
      const vault = resolveVault(config.vault, cwdOf(agent))
      if (vault === undefined) return
      if (config.installSkills !== false) {
        try {
          const result = ensureSkills(vault)
          if (result.installed.length > 0) {
            ctx.logger?.info?.(`[pko] 已投放 ${result.installed.length} 个技能：${result.installed.join(', ')}`)
          }
        } catch (error) {
          ctx.logger?.warn?.(`[pko] 技能投放失败：${String(error)}`)
        }
      }
      const context = await sessionContext(vault, { maxTokens: config.maxInjectTokens })
      if (context === undefined) return
      agent.inject(userNotice(context.text))
    } catch (error) {
      ctx.logger?.warn?.(`[pko] 会话注入失败：${String(error)}`)
    }
  }) as never)

  // ---- 任务级召回 ----
  if (config.trigger !== false) {
    on('agent/pre-step', (async (payload: { agent?: AgentLike }, next: () => Promise<unknown>) => {
      const decision = await next()
      try {
        const agent = payload?.agent
        if (agent?.inject === undefined) return decision
        const text = decisionText(decision)
        if (text === '') return decision
        const key = agent as object
        if (lastTask.get(key) === text) return decision
        lastTask.set(key, text)

        const vault = resolveVault(config.vault, cwdOf(agent))
        if (vault === undefined) return decision
        const context = await taskContext(vault, text, { maxTokens: Math.min(config.maxInjectTokens ?? 400, 200) })
        if (context === undefined) return decision
        agent.inject(userNotice(context.text))
      } catch (error) {
        ctx.logger?.warn?.(`[pko] 任务召回失败：${String(error)}`)
      }
      return decision
    }) as never)
  }

  // ---- 写入治理 ----
  if (config.guard !== false) {
    on('tools/pre-execute', (async (exec: { name?: unknown; arguments?: unknown; agent?: AgentLike }, next: () => Promise<unknown>) => {
      const decision = await next()
      try {
        const name = typeof exec?.name === 'string' ? exec.name : ''
        const args = (exec?.arguments ?? {}) as Record<string, unknown>
        const vault = resolveVault(config.vault, cwdOf(exec?.agent))
        if (vault === undefined) return decision

        if (name === 'write' || name === 'edit') {
          const file = typeof args.file_path === 'string' ? args.file_path : ''
          if (file === '') return decision
          const rel = relInsideVault(vault, file)
          if (rel === undefined) return decision
          const verdict = checkWrite({ relPath: normalizeRel(rel), tool: name, exists: existsSync(file) })
          if (!verdict.allow) return { kind: 'deny', reason: `${verdict.reason}\n${verdict.suggestion}` }
        } else if (name === 'bash') {
          const command = typeof args.command === 'string' ? args.command : ''
          const verdict = checkBash(command)
          if (!verdict.allow) return { kind: 'deny', reason: `${verdict.reason}\n${verdict.suggestion}` }
        }
      } catch (error) {
        ctx.logger?.warn?.(`[pko] 闸门判定失败：${String(error)}`)
      }
      return decision
    }) as never)
  }

  return () => { for (const off of offs) { try { off() } catch { /* 卸载期失败可忽略 */ } } }
}
