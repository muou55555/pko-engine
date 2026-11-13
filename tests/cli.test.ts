/** CLI 端到端：参数解析、分派、退出码、stdin 协议。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'packages/core/src/cli.ts')
const FIXTURE = join(ROOT, 'fixtures/vault')

interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** 起一个子进程跑 CLI，把 stdin 写进去。 */
function run(args: readonly string[], stdin = ''): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: ROOT, timeout: 30_000 },
      (error, stdout, stderr) => {
        const raw = (error as { code?: unknown } | null)?.code
        const code = error === null ? 0 : typeof raw === 'number' ? raw : 1
        resolve({ code, stdout, stderr })
      },
    )
    child.stdin?.end(stdin)
  })
}

test('cli：doctor 在含 error 的 vault 上退出码为 1', async () => {
  const result = await run(['doctor', '--vault', FIXTURE])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /PKO doctor/)
  assert.match(result.stdout, /summary: \d+ errors/)
})

test('cli：doctor 不存在的路径退出码为 2 且输出人话错误', async () => {
  const result = await run(['doctor', '--vault', '/tmp/pko-cli-missing-dir'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /无法审计 vault/)
  assert.doesNotMatch(result.stderr, /at Object\./)  // 不应出现堆栈
})

test('cli：无参数打印用法并退出 2', async () => {
  const result = await run([])
  assert.equal(result.code, 2)
  assert.match(result.stdout, /用法/)
})

test('cli：未知命令退出 2', async () => {
  const result = await run(['bogus'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /未知命令/)
})

test('cli：query 返回候选且退出 0', async () => {
  const result = await run(['query', '注意力', '--vault', FIXTURE, '--json'])
  assert.equal(result.code, 0)
  const parsed = JSON.parse(result.stdout) as { candidates: unknown[]; strategy: string }
  assert.ok(Array.isArray(parsed.candidates))
  assert.ok(parsed.candidates.length > 0)
})

test('cli：query 缺检索词退出 2', async () => {
  const result = await run(['query', '--vault', FIXTURE])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /需要一个检索词/)
})

test('cli：hook 从 stdin 读事件，拒绝时退出 2', async () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(FIXTURE, '.raw/probe.md') },
  })
  const result = await run(['hook', '--vault', FIXTURE], payload)
  assert.equal(result.code, 2)
  assert.match(result.stderr, /\.raw\//)
})

test('cli：hook 遇到非法 JSON 不崩溃', async () => {
  const result = await run(['hook', '--vault', FIXTURE], 'not json')
  assert.equal(result.code, 0)
})

test('cli：normalize 默认 dry-run 不写盘', async () => {
  const result = await run(['normalize', '--vault', FIXTURE])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /dry-run/)
})
