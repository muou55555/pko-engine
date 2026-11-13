/** @pko/dsh 插件入口：装配工具与事件，其余交给 core。 */
import z from '@deepseek-ai/schemastery'
import type { PkoConfig } from './config.ts'
import { readConfig } from './config.ts'
import { mountEvents } from './events.ts'
import { mountTools } from './tools.ts'

export const name = 'pko-engine'

/**
 * 插件配置 schema。
 *
 * 导出它之后，DSH 的「设置 → 插件」页会自动生成表单，改动写回该 profile 的
 * cordis.patch.yml —— 不需要手编辑文件，也不需要自定义客户端 UI。
 */
export const Config = z.object({
  vault: z.string().default('').description('固定知识库绝对路径；留空表示按会话目录向上查找'),
  sessionContext: z.boolean().default(false).description('会话开始时注入 hot.md 与 brain/north-star.md'),
  trigger: z.boolean().default(false).description('每次提问时按最新用户消息召回相关页面'),
  guard: z.boolean().default(true).description('写入闸门：拦截 rm 与 log.md 覆写'),
  installSkills: z.boolean().default(true).description('会话开始时把随包技能投放到 <vault>/.dsh/skills'),
  maxInjectTokens: z.number().default(400).description('单次上下文注入的 token 预算'),
})

/** 只硬依赖 tools；其余服务缺省不影响工具注册。 */
export const inject = ['tools']

export interface HostContext {
  tools: Parameters<typeof mountTools>[0]['tools']
  on(event: string, handler: (...args: never[]) => unknown): unknown
  logger?: { info?(message: string): void; warn?(message: string): void }
}

/**
 * 挂载插件。
 * @param ctx cordis 上下文
 * @param rawConfig 插件配置
 * @returns 释放函数
 */
export function apply(ctx: HostContext, rawConfig?: unknown): () => void {
  const config: PkoConfig = readConfig(rawConfig)
  const offs: Array<() => void> = []

  /** 单个挂载点失败不拖垮其余能力。 */
  const mount = (label: string, fn: () => () => void): void => {
    try {
      offs.push(fn())
    } catch (error) {
      ctx.logger?.warn?.(`[pko] ${label} 挂载失败：${String(error)}`)
    }
  }

  mount('tools', () => mountTools(ctx, config))
  mount('events', () => mountEvents(ctx, config))

  ctx.logger?.info?.(`[pko] 已挂载（vault=${config.vault ?? '按会话目录解析'}）`)
  return () => { for (const off of offs) { try { off() } catch { /* 卸载期失败可忽略 */ } } }
}
