#!/usr/bin/env node
/** pko 命令行入口：doctor / normalize / hook。 */
import { join, resolve } from 'node:path'
import type { DoctorReport, Severity } from './types.ts'
import { runDoctor } from './doctor.ts'
import { runHook } from './hook.ts'
import { acquireLock } from './lock.ts'
import { extraFields, normalizePage, renderPage } from './normalize.ts'
import { vaultPaths } from './paths.ts'
import { parseFrontmatter } from './schema.ts'
import { atomicWrite, readIfExists } from './store.ts'
import { scanVault, stemOf } from './vault.ts'
import { appendLogLine, stamp } from './writer.ts'

const USAGE = `pko — PKO 知识引擎 CLI

用法：
  pko doctor --vault <路径> [--json]
  pko normalize --vault <路径> [--apply]
  pko hook [--vault <路径>]        从 stdin 读取宿主事件 JSON

命令：
  doctor     审计 vault：frontmatter / 断链 / 孤儿页 / 重复 id
  normalize  补齐缺失的 frontmatter 字段（默认 dry-run，--apply 才写）
  hook       宿主钩子统一入口（Claude Code settings.json 调用）

退出码：doctor 有 error 为 1；用法错误为 2；hook 拒绝为 2。
`

interface Args {
  readonly command: string
  readonly vault: string
  readonly json: boolean
  readonly apply: boolean
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (arg === '--vault') {
      vault = argv[index + 1] ?? '.'
      index += 1
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--dry-run') {
      apply = false
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE)
      process.exit(0)
    }
    if (command === '') {
      command = arg
      continue
    }
    process.stderr.write(`pko: 未知参数 ${arg}\n`)
    process.exit(2)
  }
  return { command, vault, json, apply }
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
 * 以人类可读格式打印报告。
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
async function runNormalizeCommand(vault: string, apply: boolean): Promise<number> {
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
    const report = await runDoctor(resolve(args.vault))
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printReport(report)
    process.exit(report.counts.error > 0 ? 1 : 0)
  }
  if (args.command === 'normalize') {
    process.exit(await runNormalizeCommand(args.vault, args.apply))
  }
  if (args.command === 'hook') {
    process.exit(await runHookCommand(args.vault))
  }
  process.stderr.write(`pko: 未知命令 ${args.command}\n`)
  process.exit(2)
} catch (error) {
  // vault 不可读与"审计发现问题"必须区分：前者是用法错误（2），后者是结论（1）
  const reason = error instanceof Error ? error.message : String(error)
  process.stderr.write(`pko: ${reason}\n`)
  process.exit(2)
}
