/**
 * 宿主钩子的统一入口。
 *
 * Claude Code 的 settings.json 把 5 个 shell 脚本换成 `pko hook` 一个命令：
 * 它从 stdin 读同一份 JSON、按同一个事件名分派、用同样的 exit 2 表达拒绝。
 * DSH 侧不经过这里（它有自己的类型化事件），但两边调用的是同一组 policy 与 writer。
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { stat } from 'node:fs/promises'
import { acquireLock } from './lock.ts'
import { extraFields, normalizePage, renderPage } from './normalize.ts'
import { vaultPaths } from './paths.ts'
import { checkBash, checkWrite } from './policy.ts'
import { atomicWrite, readIfExists } from './store.ts'
import { parseFrontmatter } from './schema.ts'
import { toPage, stemOf } from './vault.ts'
import { recordActivity } from './writer.ts'

export interface HookOutcome {
  readonly exit: number
  readonly stdout: string
  readonly stderr: string
}

export interface HookOptions {
  readonly vault: string
  readonly now?: Date
}

const OK: HookOutcome = { exit: 0, stdout: '', stderr: '' }

/** 截断到指定字符数，超出时加省略号。 */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`
}

/** 类型收窄：普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把工具给的路径转成 vault 内相对路径；不在 vault 内返回 undefined。 */
function toRel(vault: string, file: string): string | undefined {
  const abs = isAbsolute(file) ? resolve(file) : resolve(vault, file)
  const rel = relative(vault, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/** 文件是否存在。 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** SessionStart：注入 hot.md 与 north-star。 */
async function sessionStart(options: HookOptions): Promise<HookOutcome> {
  const paths = vaultPaths(options.vault)
  const hot = await readIfExists(paths.hotFile)
  const northStar = await readIfExists(join(options.vault, 'brain', 'north-star.md'))
  const parts: string[] = []
  if (hot !== undefined) parts.push(clip(hot.trim(), 700))
  if (northStar !== undefined && northStar.trim() !== '') parts.push(`当前目标：\n${clip(northStar.trim(), 300)}`)
  if (parts.length === 0) return OK
  return { exit: 0, stdout: `[知识库] 本工作区有 PKO vault。\n\n${parts.join('\n\n')}\n`, stderr: '' }
}

/** PreToolUse：校验写目标与 shell 命令。 */
async function preTool(options: HookOptions, input: Record<string, unknown>): Promise<HookOutcome> {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : ''
  const args = isRecord(input.tool_input) ? input.tool_input : {}

  if (tool === 'write' || tool === 'edit') {
    const file = typeof args.file_path === 'string' ? args.file_path : ''
    if (file === '') return OK
    const rel = toRel(options.vault, file)
    if (rel === undefined) return OK
    const verdict = checkWrite({ relPath: rel, tool, exists: await exists(resolve(options.vault, rel)) })
    if (!verdict.allow) return { exit: 2, stdout: '', stderr: `${verdict.reason}\n${verdict.suggestion}\n` }
    return OK
  }

  if (tool === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    const verdict = checkBash(command)
    if (!verdict.allow) return { exit: 2, stdout: '', stderr: `${verdict.reason}\n${verdict.suggestion}\n` }
  }
  return OK
}

/** PostToolUse：把裸写落地的文件归一化。 */
async function postTool(options: HookOptions, input: Record<string, unknown>): Promise<HookOutcome> {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : ''
  if (tool !== 'write' && tool !== 'edit') return OK
  const args = isRecord(input.tool_input) ? input.tool_input : {}
  const file = typeof args.file_path === 'string' ? args.file_path : ''
  if (file === '') return OK
  const rel = toRel(options.vault, file)
  if (rel === undefined) return OK

  const abs = resolve(options.vault, rel)
  const now = options.now ?? new Date()
  const paths = vaultPaths(options.vault)
  const lock = await acquireLock(paths.lockFile)
  try {
    const text = await readIfExists(abs)
    if (text === undefined) return OK
    const { page, changed } = normalizePage(toPage(rel, text), { stem: stemOf(rel), now })
    if (changed.length === 0) return OK
    await atomicWrite(abs, renderPage(page, extraOf(text)))
    await recordActivity(paths.activityFile, now)
    return { exit: 0, stdout: `[pko] 已补齐 frontmatter：${changed.join('、')}（${rel}）\n`, stderr: '' }
  } finally {
    await lock.release()
  }
}

/** Stop：vault 有改动但 hot.md 未更新时提醒。 */
async function stop(options: HookOptions): Promise<HookOutcome> {
  const paths = vaultPaths(options.vault)
  const raw = await readIfExists(paths.activityFile)
  if (raw === undefined) return OK
  let ts = 0
  try {
    const parsed = JSON.parse(raw) as { ts?: number }
    ts = Number(parsed.ts ?? 0)
  } catch {
    return OK
  }
  let hotMtime = 0
  try {
    hotMtime = (await stat(paths.hotFile)).mtimeMs
  } catch {
    hotMtime = 0
  }
  if (ts > hotMtime) {
    return { exit: 0, stdout: '[知识库] 本次会话改动过 vault，建议更新 50-Wiki/hot.md（≤500 字，完整覆写）。\n', stderr: '' }
  }
  return OK
}

/** 从文件原文取出非契约字段。 */
function extraOf(text: string): Readonly<Record<string, string | readonly string[]>> {
  return extraFields(parseFrontmatter(text)?.data)
}

/**
 * 执行一次钩子调用。
 * @param rawInput stdin 原文（Claude Code hook JSON）
 * @param options.vault vault 根目录
 * @returns 退出码与输出；exit 2 表示拒绝
 */
export async function runHook(rawInput: string, options: HookOptions): Promise<HookOutcome> {
  let input: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawInput)
    if (!isRecord(parsed)) return OK
    input = parsed
  } catch {
    return OK
  }
  const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : ''
  switch (event) {
    case 'SessionStart':
      return sessionStart(options)
    case 'PreToolUse':
      return preTool(options, input)
    case 'PostToolUse':
      return postTool(options, input)
    case 'Stop':
      return stop(options)
    default:
      return OK
  }
}
