/**
 * 功能测试：按"用户做一件事 → 系统应变成什么样"来断言。
 *
 * 与单元测试的区别：这里不关心函数签名或分支，只看最终用户可见的结果
 * （文件长什么样、检索给不给用、日志记没记、坏操作有没有被挡住）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { writePage } from '../packages/core/src/writer.ts'
import { runDoctor } from '../packages/core/src/doctor.ts'
import { retrieve } from '../packages/core/src/retrieve.ts'
import { sessionContext, taskContext } from '../packages/core/src/context.ts'
import { runHook } from '../packages/core/src/hook.ts'
import { atomicWrite } from '../packages/core/src/store.ts'
import { normalizePage, renderPage } from '../packages/core/src/normalize.ts'
import { toPage } from '../packages/core/src/vault.ts'
import { sha256 } from '../packages/core/src/hash.ts'

async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-func-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  return root
}

/** 造一个"像真的"小库：PARA + MOC + 索引。 */
async function makeRealisticVault(): Promise<string> {
  const root = await makeVault()
  await writePage({ vault: root, relPath: '40-Resources/concepts/cache-penetration.md', body: '# 缓存穿透\n\n布隆过滤器与空值缓存是常见解法。' })
  await writePage({ vault: root, relPath: '40-Resources/concepts/cache-avalanche.md', body: '# 缓存雪崩\n\n过期时间加随机抖动。' })
  await writePage({ vault: root, relPath: '30-Areas/work/company/weekly.md', body: '# 周会记录\n\n本周讨论了缓存问题。' })
  await atomicWrite(join(root, '10-Atlas/moc-llm.md'), '---\nid: moc-llm\ntitle: 大模型 MOC\ntype: moc\ntier: supporting\ntags: [moc]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 大模型\n\n- [[cache-penetration]] — 概念\n- [[missing-page]] — 断链示例\n')
  await atomicWrite(join(root, '50-Wiki/index.md'), '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n\n- [[cache-penetration]] — 缓存穿透\n')
  return root
}

test('功能：摄取一篇资料后，页面/日志/manifest 三处都留下痕迹', async () => {
  const root = await makeVault()
  const content = '# 缓存穿透\n\n布隆过滤器 + 空值缓存'
  const digest = sha256(content)

  const result = await writePage({
    vault: root,
    relPath: '40-Resources/concepts/cache-penetration.md',
    body: content,
    sourceKey: 'https://example.com/cache',
    contentHash: digest,
  })
  assert.equal(result.changed, true)

  const page = await readFile(join(root, '40-Resources/concepts/cache-penetration.md'), 'utf8')
  assert.match(page, /^---\n/)
  assert.match(page, /type: note/)
  assert.match(page, /summary:/)

  const log = await readFile(join(root, '50-Wiki/log.md'), 'utf8')
  assert.match(log, /write 40-Resources\/concepts\/cache-penetration\.md/)

  const manifest = JSON.parse(await readFile(join(root, '.pko/manifest.json'), 'utf8')) as {
    sources: Record<string, { hash: string }>
  }
  assert.equal(manifest.sources['https://example.com/cache']?.hash, digest)
})

test('功能：同一份资料再摄取一次不产生重复（日志不增长）', async () => {
  const root = await makeVault()
  const content = '# 幂等\n\n同一份内容'
  const args = {
    vault: root,
    relPath: '40-Resources/concepts/idem.md',
    body: content,
    sourceKey: 'https://example.com/idem',
    contentHash: sha256(content),
  }
  await writePage(args)
  const logAfterFirst = await readFile(join(root, '50-Wiki/log.md'), 'utf8')
  const second = await writePage(args)
  assert.equal(second.skipped, true)
  assert.equal(await readFile(join(root, '50-Wiki/log.md'), 'utf8'), logAfterFirst)
})

test('功能：收件箱里的裸文件整理后不再是"缺 frontmatter"错误', async () => {
  const root = await makeVault()
  const rel = '00-Inbox/随手记.md'
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, '# 随手记\n\n一个还没整理的想法\n')

  const before = await runDoctor(root)
  assert.ok(before.findings.some((f) => f.path === rel && f.code === 'E_NO_FRONTMATTER'))

  const page = normalizePage(toPage(rel, await readFile(abs, 'utf8')), { stem: '随手记' }).page
  await atomicWrite(abs, renderPage(page))

  const after = await runDoctor(root)
  assert.equal(after.findings.filter((f) => f.path === rel && f.severity === 'error').length, 0)
})

test('功能：问"缓存穿透怎么处理"能命中相关页，且不相关的排在其后', async () => {
  const root = await makeRealisticVault()
  const result = await retrieve(root, '缓存穿透怎么处理')
  assert.ok(result.candidates.length > 0)
  const top = result.candidates[0]
  assert.equal(top?.id, 'cache-penetration')
  const avalancheRank = result.candidates.findIndex((c) => c.id === 'cache-avalanche')
  assert.notEqual(avalancheRank, 0)
})

test('功能：会话开始注入近期上下文；空库时保持沉默', async () => {
  const empty = await makeVault()
  assert.equal(await sessionContext(empty), undefined)

  const root = await makeVault()
  await writeFile(join(root, '50-Wiki/hot.md'), '# Hot\n\n正在做 PKO 引擎接入\n')
  await mkdir(join(root, 'brain'), { recursive: true })
  await writeFile(join(root, 'brain/north-star.md'), '# 目标\n\n把知识库做成多 Agent 共用\n')

  const context = await sessionContext(root)
  assert.ok(context !== undefined)
  assert.match(context.text, /PKO 引擎接入/)
  assert.match(context.text, /多 Agent 共用/)
})

test('功能：提问时自动召回；无关提问不注入噪声', async () => {
  const root = await makeRealisticVault()
  const hit = await taskContext(root, '缓存穿透有哪些解法')
  assert.ok(hit !== undefined)
  assert.match(hit.text, /cache-penetration/)

  const miss = await taskContext(root, '今晚吃什么比较好')
  assert.equal(miss, undefined)
})

test('功能：原始材料被改或被删都会被挡下来', async () => {
  const root = await makeVault()
  const target = join(root, '.raw/source.md')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, '原始材料')

  const edit = await runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: target },
  }), { vault: root })
  assert.equal(edit.exit, 2)

  const remove = await runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -f .raw/source.md' },
  }), { vault: root })
  assert.equal(remove.exit, 2)
  assert.equal(await readFile(target, 'utf8'), '原始材料')
})

test('功能：更新已有知识时时间戳正确、不产生新文件', async () => {
  const root = await makeVault()
  const rel = '40-Resources/concepts/evolve.md'
  await writePage({ vault: root, relPath: rel, body: '# 演进\n\n第一版', now: new Date('2026-03-01T00:00:00Z') })
  await writePage({ vault: root, relPath: rel, body: '# 演进\n\n第二版，补了新结论', now: new Date('2026-04-01T00:00:00Z') })

  const text = await readFile(join(root, rel), 'utf8')
  assert.match(text, /created: 2026-03-01/)
  assert.match(text, /updated: 2026-04-01/)
  assert.match(text, /第二版/)

  const files = await readdir(join(root, '40-Resources/concepts'))
  assert.deepEqual(files, ['evolve.md'])
})

test('功能：脏库归一化后 error 归零（人工目录不需要重建）', async () => {
  const root = await makeVault()
  await mkdir(join(root, '40-Resources/concepts'), { recursive: true })
  await writeFile(join(root, '40-Resources/concepts/a.md'), '# 甲\n\n甲正文\n')
  await writeFile(join(root, '40-Resources/concepts/b.md'), '---\ntitle: 乙\n---\n\n乙正文\n')

  const before = await runDoctor(root)
  assert.ok(before.counts.error > 0)

  for (const rel of ['40-Resources/concepts/a.md', '40-Resources/concepts/b.md']) {
    const abs = join(root, rel)
    const page = normalizePage(toPage(rel, await readFile(abs, 'utf8')), { stem: rel.split('/').pop()?.replace('.md', '') ?? rel }).page
    await atomicWrite(abs, renderPage(page))
  }

  const after = await runDoctor(root)
  assert.equal(after.counts.error, 0)
})

test('功能：索引页与日志页始终不被当作知识页改写', async () => {
  const root = await makeVault()
  const indexBefore = '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n'
  await writeFile(join(root, '50-Wiki/index.md'), indexBefore)
  await runHook(JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(root, '50-Wiki/index.md') },
  }), { vault: root })
  assert.equal(await readFile(join(root, '50-Wiki/index.md'), 'utf8'), indexBefore)
  assert.ok((await stat(join(root, '50-Wiki/index.md'))).size > 0)
})
