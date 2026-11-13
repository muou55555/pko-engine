/** P1 回归测试：锁 / 原子写 / 策略 / 归一化 / 写入协议 / hook。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock } from '../packages/core/src/lock.ts'
import { atomicWrite } from '../packages/core/src/store.ts'
import { checkBash, checkWrite } from '../packages/core/src/policy.ts'
import { extraFields, normalizePage, renderPage } from '../packages/core/src/normalize.ts'
import { writePage } from '../packages/core/src/writer.ts'
import { runHook } from '../packages/core/src/hook.ts'
import { parseFrontmatter } from '../packages/core/src/schema.ts'
import { toPage } from '../packages/core/src/vault.ts'

/** 建一个带必要目录的临时 vault。 */
async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-p1-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await mkdir(join(root, '40-Resources', 'concepts'), { recursive: true })
  await mkdir(join(root, '.raw'), { recursive: true })
  return root
}

test('atomicWrite 写入内容且不残留临时文件', async () => {
  const root = await makeVault()
  const target = join(root, 'a.md')
  await atomicWrite(target, 'hello')
  assert.equal(await readFile(target, 'utf8'), 'hello')
  assert.deepEqual((await readdir(root)).sort(), ['.raw', '40-Resources', '50-Wiki', 'a.md'])
})

test('锁互斥：持有期间第二个获取者超时', async () => {
  const root = await makeVault()
  const lockPath = join(root, '.pko', 'lock.json')
  const first = await acquireLock(lockPath)
  await assert.rejects(() => acquireLock(lockPath, { waitMs: 120 }), /获取锁超时/)
  await first.release()
  const second = await acquireLock(lockPath, { waitMs: 300 })
  await second.release()
})

test('陈旧锁可被接管（异主机 + 超时）', async () => {
  const root = await makeVault()
  const lockPath = join(root, '.pko', 'lock.json')
  await mkdir(join(root, '.pko'), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ pid: 999_999, host: 'other-host', ts: Date.now() - 60_000, token: 'x' }))
  const handle = await acquireLock(lockPath, { waitMs: 500 })
  await handle.release()
})

test('策略：.raw 不可改、log.md 只追加、rm 被拦', () => {
  assert.equal(checkWrite({ relPath: '.raw/a.md', tool: 'edit', exists: true }).allow, false)
  assert.equal(checkWrite({ relPath: '.raw/a.md', tool: 'write', exists: true }).allow, false)
  assert.equal(checkWrite({ relPath: '.raw/new.md', tool: 'write', exists: false }).allow, true)
  assert.equal(checkWrite({ relPath: '50-Wiki/log.md', tool: 'write', exists: true }).allow, false)
  assert.equal(checkWrite({ relPath: '50-Wiki/log.md', tool: 'edit', exists: true }).allow, true)
  assert.equal(checkWrite({ relPath: '40-Resources/x.md', tool: 'write', exists: true }).allow, true)
  assert.equal(checkBash('rm notes.md').allow, false)
  assert.equal(checkBash('mv notes.md 90-Archive/').allow, true)
  assert.equal(checkBash('ls -la').allow, true)
})

test('归一化补齐 title/type/created/summary', () => {
  const page = toPage('x.md', '# 标题\n\n正文第一行')
  const { page: fixed, changed } = normalizePage(page, { stem: 'x', now: new Date('2026-01-01T00:00:00Z') })
  assert.deepEqual([...changed].sort(), ['created', 'summary', 'title', 'type', 'updated'])
  assert.equal(fixed.title, '标题')
  assert.equal(fixed.type, 'note')
  assert.equal(fixed.summary, '正文第一行')
  assert.equal(fixed.created, '2026-01-01T00:00:00.000Z')
})

test('渲染保留非契约字段（不丢剪藏元数据）', () => {
  const text = '---\nid: a\ntitle: A\nauthor: 张三\ndescription: 一段说明\n---\n正文\n'
  const parsed = parseFrontmatter(text)
  const page = toPage('a.md', text)
  const rendered = renderPage(normalizePage(page, { stem: 'a' }).page, extraFields(parsed?.data))
  assert.match(rendered, /author: 张三/)
  assert.match(rendered, /description: 一段说明/)
  assert.match(rendered, /^---\nid: a/m)
})

test('writePage：写文件 + 追加日志 + 记录活动', async () => {
  const root = await makeVault()
  const result = await writePage({ vault: root, relPath: '40-Resources/concepts/x.md', body: '# X\n\n内容' })
  assert.equal(result.changed, true)
  assert.equal(result.skipped, false)

  const written = await readFile(join(root, '40-Resources/concepts/x.md'), 'utf8')
  assert.match(written, /id: x/)
  assert.match(written, /type: note/)

  const log = await readFile(join(root, '50-Wiki/log.md'), 'utf8')
  assert.match(log, /write 40-Resources\/concepts\/x\.md/)

  const activity = JSON.parse(await readFile(join(root, '.pko/activity.json'), 'utf8')) as { ts: number }
  assert.ok(activity.ts > 0)
})

test('writePage：内容未变时跳过，不重复写日志', async () => {
  const root = await makeVault()
  await writePage({ vault: root, relPath: '40-Resources/concepts/x.md', body: '# X\n\n内容' })
  const logBefore = await readFile(join(root, '50-Wiki/log.md'), 'utf8')
  const again = await writePage({ vault: root, relPath: '40-Resources/concepts/x.md', body: '# X\n\n内容' })
  assert.equal(again.skipped, true)
  assert.equal(await readFile(join(root, '50-Wiki/log.md'), 'utf8'), logBefore)
})

test('writePage：版本不匹配抛冲突，且不写文件', async () => {
  const root = await makeVault()
  await assert.rejects(
    () => writePage({ vault: root, relPath: '40-Resources/concepts/y.md', body: 'x', expectedHash: 'sha256:dead' }),
    /写入冲突/,
  )
  await assert.rejects(() => readFile(join(root, '40-Resources/concepts/y.md'), 'utf8'), /ENOENT/)
})

test('hook PreToolUse 拒绝编辑 .raw', async () => {
  const root = await makeVault()
  const target = join(root, '.raw', 'a.md')
  await writeFile(target, '原始材料')
  const outcome = await runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'edit', tool_input: { file_path: target },
  }), { vault: root })
  assert.equal(outcome.exit, 2)
  assert.match(outcome.stderr, /\.raw\//)
})

test('hook SessionStart 注入 hot.md', async () => {
  const root = await makeVault()
  await writeFile(join(root, '50-Wiki', 'hot.md'), '# Hot\n\n近期上下文内容')
  const outcome = await runHook(JSON.stringify({ hook_event_name: 'SessionStart' }), { vault: root })
  assert.equal(outcome.exit, 0)
  assert.match(outcome.stdout, /近期上下文内容/)
})

test('hook PostToolUse 为裸写文件补齐 frontmatter', async () => {
  const root = await makeVault()
  const target = join(root, '40-Resources', 'concepts', 'raw.md')
  await writeFile(target, '# 裸写标题\n\n裸写正文\n')
  const outcome = await runHook(JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'write', tool_input: { file_path: target },
  }), { vault: root })
  assert.equal(outcome.exit, 0)
  assert.match(outcome.stdout, /已补齐 frontmatter/)
  const fixed = await readFile(target, 'utf8')
  assert.match(fixed, /^---\n/)
  assert.match(fixed, /type: note/)
})

test('writePage：内容变化时刷新 updated，created 与 id 保持稳定', async () => {
  const root = await makeVault()
  const rel = '40-Resources/concepts/x.md'
  await writePage({ vault: root, relPath: rel, body: '# X\n\nv1', now: new Date('2026-01-01T00:00:00Z') })
  const first = await readFile(join(root, rel), 'utf8')
  await writePage({ vault: root, relPath: rel, body: '# X\n\nv2', now: new Date('2026-02-02T00:00:00Z') })
  const second = await readFile(join(root, rel), 'utf8')
  assert.match(first, /updated: 2026-01-01T00:00:00\.000Z/)
  assert.match(second, /updated: 2026-02-02T00:00:00\.000Z/)
  assert.match(second, /created: 2026-01-01T00:00:00\.000Z/)
  assert.match(second, /id: x/)
})

test('writePage：提供 sourceKey 与 contentHash 时写入 manifest', async () => {
  const root = await makeVault()
  await writePage({
    vault: root,
    relPath: '40-Resources/concepts/m.md',
    body: '# M\n\n内容',
    sourceKey: 'https://example.com/a',
    contentHash: 'sha256:abc',
  })
  const raw = await readFile(join(root, '.pko/manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as { version: number; sources: Record<string, { hash: string; pages: string[]; producedBy: string }> }
  assert.equal(manifest.version, 1)
  assert.equal(manifest.sources['https://example.com/a']?.hash, 'sha256:abc')
  assert.deepEqual(manifest.sources['https://example.com/a']?.pages, ['m'])
  assert.match(manifest.sources['https://example.com/a']?.producedBy ?? '', /^@pko\/core@/)
})

test('写入：相对路径越出 vault 被拒绝', async () => {
  const root = await makeVault()
  await assert.rejects(
    () => writePage({ vault: root, relPath: '../escape.md', body: '# 越界' }),
    /越出 vault/,
  )
  await assert.rejects(() => readFile(join(root, '..', 'escape.md'), 'utf8'), /ENOENT/)
})

test('写入：绝对路径被归一化为 vault 内相对路径（不会写到 /etc）', async () => {
  const root = await makeVault()
  const result = await writePage({ vault: root, relPath: '/etc/passwd.md', body: '# 归一化' })
  assert.equal(result.relPath, 'etc/passwd.md')
  assert.match(await readFile(join(root, 'etc', 'passwd.md'), 'utf8'), /id: passwd/)
})

test('写入：绕行路径（a/../../、反斜杠）被拒绝', async () => {
  const root = await makeVault()
  for (const relPath of ['a/../../escape2.md', '..\\escape3.md', '..']) {
    await assert.rejects(() => writePage({ vault: root, relPath, body: 'x' }), /越出 vault/)
  }
})

test('manifest：版本高于本进程支持时拒绝读取', async () => {
  const root = await makeVault()
  await mkdir(join(root, '.pko'), { recursive: true })
  await writeFile(join(root, '.pko/manifest.json'), JSON.stringify({ version: 99, sources: {} }))
  const { readManifest } = await import('../packages/core/src/manifest.ts')
  await assert.rejects(() => readManifest(join(root, '.pko/manifest.json')), /manifest 版本/)
})

test('写入：vault 内指向外部的符号链接被拒绝', async () => {
  const { symlink } = await import('node:fs/promises')
  const root = await makeVault()
  const outside = await mkdtemp(join(tmpdir(), 'pko-outside-'))
  await symlink(outside, join(root, 'link'))
  await assert.rejects(() => writePage({ vault: root, relPath: 'link/escaped.md', body: '# 逃逸' }), /越出 vault/)
  await assert.rejects(() => readFile(join(outside, 'escaped.md'), 'utf8'), /ENOENT/)
})
