/** 并发与崩溃一致性：跨进程竞态、锁接管、临时文件清理。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../packages/core/src/hash.ts'
import { acquireLock } from '../packages/core/src/lock.ts'
import { atomicWrite } from '../packages/core/src/store.ts'
import { writePage } from '../packages/core/src/writer.ts'

const HELPERS = fileURLToPath(new URL('./helpers', import.meta.url))

async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-conc-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  return root
}

/** 跑一个 helper 子进程并解析 JSON。 */
function runHelper(script: string, args: readonly string[]): Promise<{ ok: boolean; tag: string; name?: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(HELPERS, script), ...args], { timeout: 90_000 }, (error, stdout) => {
      const line = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(line) as { ok: boolean; tag: string; name?: string })
      } catch {
        reject(new Error(`子进程输出无法解析：${line || String(error)}`))
      }
    })
  })
}

test('并发：两个进程用同一期望哈希写同一文件，只有一个成功', async () => {
  const vault = await makeVault()
  const rel = '40-Resources/race.md'
  await writePage({ vault, relPath: rel, body: '# 竞态\n\n初始内容' })
  const expected = sha256(await readFile(join(vault, rel), 'utf8'))

  const results = await Promise.all([
    runHelper('race-writer.mjs', [vault, rel, 'A', expected, '0']),
    runHelper('race-writer.mjs', [vault, rel, 'B', expected, '15']),
  ])

  const succeeded = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  assert.equal(succeeded.length, 1, `应只有一个成功，实际 ${succeeded.length}`)
  assert.equal(failed.length, 1)
  assert.equal(failed[0]?.name, 'ConflictError', '失败方必须是显式冲突，不是静默覆盖')

  const final = await readFile(join(vault, rel), 'utf8')
  assert.match(final, new RegExp(`来自 ${succeeded[0]?.tag}`), '落盘内容必须是成功方写的')
})

test('崩溃一致性：持有者被杀后，锁在 TTL 后能被接管', async () => {
  const vault = await makeVault()
  const lockPath = join(vault, '.pko', 'lock.json')
  const child = spawn(process.execPath, [join(HELPERS, 'lock-holder.mjs'), lockPath, '30000'], { stdio: 'pipe' })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('子进程未及时持锁')), 30_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('HELD')) {
        clearTimeout(timer)
        resolve()
      }
    })
  })

  await assert.rejects(() => acquireLock(lockPath, { waitMs: 150, ttlMs: 60_000 }), /获取锁超时/)

  child.kill('SIGKILL')
  await new Promise((resolve) => child.once('exit', resolve))

  // TTL 设小：陈旧的死锁应被接管
  const handle = await acquireLock(lockPath, { waitMs: 10_000, ttlMs: 100 })
  await handle.release()
})

test('崩溃一致性：写入失败时不留临时文件', async () => {
  const vault = await makeVault()
  // 目标是一个目录：rename 会失败，临时文件必须被清掉
  const target = join(vault, 'occupied.md')
  await mkdir(join(target), { recursive: true })
  await assert.rejects(() => atomicWrite(target, '内容'))
  const leftovers = (await readdir(vault)).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [], `不应残留临时文件，实际：${leftovers.join(', ')}`)
})

test('崩溃一致性：目标文件不会出现半截内容', async () => {
  const vault = await makeVault()
  const target = join(vault, 'atomic.md')
  await atomicWrite(target, '旧内容')
  const content = '新'.repeat(200_000)
  await Promise.all([atomicWrite(target, '中途内容'), atomicWrite(target, content)])
  const final = await readFile(target, 'utf8')
  assert.ok(final === '中途内容' || final === content, '读到的必须是某一次完整写入')
})
