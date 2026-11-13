#!/usr/bin/env node
/** pko 命令行入口：doctor / normalize / query / context / hook。 */
import { join, resolve } from 'node:path'
import type { DoctorReport, Severity } from './types.ts'
import { bodyContext, sessionContext, taskContext } from './context.ts'
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoint.ts'
import { runDoctor } from './doctor.ts'
import { runHook } from './hook.ts'
import { acquireLock } from './lock.ts'
import { extraFields, normalizePage, renderPage } from './normalize.ts'
import { vaultPaths } from './paths.ts'
import { retrieve } from './retrieve.ts'
import { parseFrontmatter } from './schema.ts'
import { atomicWrite, readIfExists } from './store.ts'
import { scanVault, stemOf } from './vault.ts'
import { appendLogLine, stamp } from './writer.ts'

const USAGE = `pko — PKO 知识引擎 CLI

用法：
  pko doctor    --vault <路径> [--json]
  pko normalize --vault <路径> [--apply]
  pko query <词> --vault <路径> [--json] [--mode auto|index-only] [--max N] [--deep]
  pko context   --vault <路径> [--task "<原话>"] [--page <id>] [--json]
  pko checkpoint  [--vault <路径>]      创建还原点（git ref，不动工作区）
  pko checkpoints [--vault <路径>]      列出还原点
  pko restore <id> --vault <路径>       恢复到某个还原点
  pko hook        [--vault <路径>]      从 stdin 读取宿主事件 JSON

命令：
  doctor     审计 vault：frontmatter / 断链 / 孤儿页 / 重复 id
  normalize  补齐缺失的 frontmatter 字段（默认 dry-run）
  query      分层检索：index → 标题/标签/摘要 → 正文 → 双链邻居
  context    输出三档上下文之一：会话档 / 任务档 / 整页档
  checkpoint 创建 git 还原点（快照工作区，不改变当前状态）
  checkpoints 列出还原点
  restore    把某个还原点的内容恢复到工作区
  hook       宿主钩子统一入口（Claude Code settings.json 调用）

退出码：doctor 有 error 为 1；用法错误为 2；hook 拒绝为 2。
`

interface Args {
  readonly command: string
  readonly positional: readonly string[]
  readonly vault: string
  readonly json: boolean
  readonly apply: boolean
  readonly deep: boolean
  readonly mode: 'auto' | 'index-only'
  readonly max: number
  readonly task: string | undefined
  readonly page: string | undefined
}

/**
 * 解析命令行参数。
 * @param argv `process.argv.slice(2)`
 * @returns 解析结果
 */
function parseArgs(argv: readonly string[]): Args {
  let command = ''
  let vault = '.'
  let json = false
  let apply = false
  let deep = false
  let mode: 'auto' | 'index-only' = 'auto'
  let max = 10
  let task: string | undefined
  let page: string | undefined
  const positional: string[] = []

  const valueAt = (index: number, flag: string): string => {
    const value = argv[index + 1]
    if (value === undefined) {
      process.stderr.write(`pko: ${flag} 需要一个值\n`)
      process.exit(2)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (arg === '--vault') { vault = valueAt(index, '--vault'); index += 1; continue }
    if (arg === '--task') { task = valueAt(index, '--task'); index += 1; continue }
    if (arg === '--page') { page = valueAt(index, '--page'); index += 1; continue }
    if (arg === '--max') { max = Number(valueAt(index, '--max')); index += 1; continue }
    if (arg === '--mode') {
      mode = valueAt(index, '--mode') === 'index-only' ? 'index-only' : 'auto'
      index += 1
      continue
    }
    if (arg === '--json') { json = true; continue }
    if (arg === '--apply') { apply = true; continue }
    if (arg === '--dry-run') { apply = false; continue }
    if (arg === '--deep') { deep = true; continue }
    if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE); process.exit(0) }
    if (command === '') { command = arg; continue }
    positional.push(arg)
  }
  return { command, positional, vault, json, apply, deep, mode, max, task, page }
}

/** 读取 stdin 全部内容；TTY 下返回空串。 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY === true) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

const LABEL: Record<Severity, string> = { error: 'error', warn: 'warn ', info: 'info ' }
const ORDER: readonly Severity[] = ['error', 'warn', 'info']

/**
 * 以人类可读格式打印审计报告。
 * @param report doctor 报告
 */
function printReport(report: DoctorReport): void {
  const lines: string[] = [`PKO doctor — ${report.vault}`, `pages: ${report.pages}`, '']
  const sorted = [...report.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
    || a.path.localeCompare(b.path)
    || a.code.localeCompare(b.code))
  const width = sorted.reduce((max, finding) => Math.max(max, finding.code.length), 0)
  for (const finding of sorted) {
    const pad = ' '.repeat(7 + width + 2)
    lines.push(`${LABEL[finding.severity]}  ${finding.code.padEnd(width)}  ${finding.path}`)
    lines.push(`${pad}${finding.message}`)
    if (finding.fix !== undefined) lines.push(`${pad}→ ${finding.fix}`)
  }
  lines.push('', `summary: ${report.counts.error} errors, ${report.counts.warn} warnings, ${report.counts.info} info`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * normalize 子命令。
 * @param vault vault 根目录
 * @param apply true = 写盘
 * @returns 退出码
 */
async function runNormalize(vault: string, apply: boolean): Promise<number> {
  const root = resolve(vault)
  const { pages } = await scanVault(root)
  const pending = pages
    .map((page) => ({ original: page, ...normalizePage(page, { stem: stemOf(page.path) }) }))
    .filter((item) => item.changed.length > 0)

  if (pending.length === 0) {
    process.stdout.write('pko: 无需归一化，所有页面已合规\n')
    return 0
  }
  for (const item of pending) {
    process.stdout.write(`${apply ? 'fix ' : 'plan'} ${item.original.path}  ← 补 ${item.changed.join('、')}\n`)
  }
  if (!apply) {
    process.stdout.write(`\npko: 共 ${pending.length} 页待修复（dry-run，加 --apply 执行）\n`)
    return 0
  }

  const paths = vaultPaths(root)
  const lock = await acquireLock(paths.lockFile, { waitMs: 10_000 })
  try {
    for (const item of pending) {
      const raw = await readIfExists(join(root, item.original.path))
      const preserved = extraFields(parseFrontmatter(raw ?? '')?.data)
      await atomicWrite(join(root, item.original.path), renderPage(item.page, preserved))
    }
    await appendLogLine(paths.logFile, `- [${stamp(new Date())}] normalize ${pending.length} 页`)
  } finally {
    await lock.release()
  }
  process.stdout.write(`\npko: 已归一化 ${pending.length} 页\n`)
  return 0
}

/**
 * query 子命令。
 * @param args 解析后的参数
 * @returns 退出码
 */
async function runQuery(args: Args): Promise<number> {
  const query = args.positional.join(' ').trim()
  if (query === '') {
    process.stderr.write('pko: query 需要一个检索词\n')
    return 2
  }
  const result = await retrieve(resolve(args.vault), query, {
    mode: args.mode,
    maxCandidates: args.max,
    deep: args.deep,
  })
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  }
  process.stdout.write(`检索到 ${result.candidates.length} 条（策略 ${result.strategy}），共 ${result.totalPages} 页\n`)
  result.candidates.forEach((candidate, index) => {
    process.stdout.write(`${index + 1}. ${candidate.score}  ${candidate.path} — ${candidate.title}  [${candidate.matchedBy}]\n`)
    if (candidate.snippet !== undefined) process.stdout.write(`   ${candidate.snippet}\n`)
  })
  return 0
}

/**
 * context 子命令。
 * @param args 解析后的参数
 * @returns 退出码
 */
async function runContext(args: Args): Promise<number> {
  const root = resolve(args.vault)
  const context = args.page !== undefined
    ? await bodyContext(root, args.page)
    : args.task !== undefined
      ? await taskContext(root, args.task)
      : await sessionContext(root)
  if (context === undefined) {
    process.stdout.write('pko: 没有可注入的上下文\n')
    return 0
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`)
    return 0
  }
  process.stdout.write(`${context.text}\n`)
  return 0
}

/**
 * hook 子命令：读 stdin，分派后把结果写回宿主协议。
 * @param vault vault 根目录
 * @returns 退出码（2 = 拒绝）
 */
async function runHookCommand(vault: string): Promise<number> {
  const raw = await readStdin()
  const outcome = await runHook(raw, { vault: resolve(vault) })
  if (outcome.stdout !== '') process.stdout.write(outcome.stdout)
  if (outcome.stderr !== '') process.stderr.write(outcome.stderr)
  return outcome.exit
}

// ---- 主流程 ----
const args = parseArgs(process.argv.slice(2))
if (args.command === '') {
  process.stdout.write(USAGE)
  process.exit(2)
}

try {
  if (args.command === 'doctor') {
    let report: DoctorReport
    try {
      report = await runDoctor(resolve(args.vault))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(`pko: 无法审计 vault "${args.vault}"：${reason}\n`)
      process.exit(2)
    }
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printReport(report)
    process.exit(report.counts.error > 0 ? 1 : 0)
  }
  if (args.command === 'normalize') process.exit(await runNormalize(args.vault, args.apply))
  if (args.command === 'checkpoint') {
    const checkpoint = await createCheckpoint(resolve(args.vault))
    process.stdout.write(`已创建还原点 ${checkpoint.id}（${checkpoint.sha.slice(0, 8)}）\n`)
    process.exit(0)
  }
  if (args.command === 'checkpoints') {
    const list = await listCheckpoints(resolve(args.vault))
    if (list.length === 0) {
      process.stdout.write('pko: 还没有任何还原点\n')
      process.exit(0)
    }
    for (const item of list) process.stdout.write(`${item.id}  ${item.sha.slice(0, 8)}\n`)
    process.exit(0)
  }
  if (args.command === 'restore') {
    const id = args.positional[0]
    if (id === undefined) {
      process.stderr.write('pko: restore 需要一个还原点 id\n')
      process.exit(2)
    }
    const result = await restoreCheckpoint(resolve(args.vault), id)
    process.stdout.write(`已恢复到 ${id}（${result.sha.slice(0, 8)}）。注意：之后新增的文件不会被删除。\n`)
    process.exit(0)
  }
  if (args.command === 'query') process.exit(await runQuery(args))
  if (args.command === 'context') process.exit(await runContext(args))
  if (args.command === 'hook') process.exit(await runHookCommand(args.vault))
  process.stderr.write(`pko: 未知命令 ${args.command}\n`)
  process.exit(2)
} catch (error) {
  // vault 不可读与"审计发现问题"必须区分：前者是用法错误（2），后者是结论（1）
  const reason = error instanceof Error ? error.message : String(error)
  process.stderr.write(`pko: ${reason}\n`)
  process.exit(2)
}
