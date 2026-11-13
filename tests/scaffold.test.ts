/** 知识库骨架：检测、初始化、幂等、安全护栏。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyScaffold, hasVaultMarker, planScaffold, vaultStatus } from '../packages/core/src/scaffold.ts'
import { runDoctor } from '../packages/core/src/doctor.ts'

/** 建一个临时目录。 */
async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pko-scaffold-'))
}

test('init：空目录生成标准骨架，且初始化后体检零发现', async () => {
  const root = await tempDir()
  await applyScaffold(await planScaffold(root))

  assert.equal(await hasVaultMarker(root), true, '初始化后应能被识别为 vault')
  const status = await vaultStatus(root)
  assert.equal(status.isVault, true)
  assert.deepEqual(status.missingDirs, [], '不应缺少标准目录')

  const report = await runDoctor(root)
  assert.equal(report.counts.error, 0, `初始化后不应有 error：${report.findings.map((f) => f.code).join(',')}`)
})

test('init：幂等，第二次不创建任何东西', async () => {
  const root = await tempDir()
  await applyScaffold(await planScaffold(root))

  const second = await planScaffold(root)
  assert.deepEqual(second.dirs, [])
  assert.deepEqual(second.files, [])
})

test('init：不覆盖用户已存在或已修改的文件', async () => {
  const root = await tempDir()
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await writeFile(join(root, '50-Wiki/hot.md'), '# 我自己的内容\n', 'utf8')

  await applyScaffold(await planScaffold(root))
  assert.equal(await readFile(join(root, '50-Wiki/hot.md'), 'utf8'), '# 我自己的内容\n', '不得覆盖已有文件')
})

test('init：非空且不像知识库的目录需要 force', async () => {
  const root = await tempDir()
  await writeFile(join(root, 'random.txt'), 'x', 'utf8')

  const plan = await planScaffold(root)
  assert.equal(plan.needsForce, true)
  await assert.rejects(() => applyScaffold(plan), /请加 --force/)

  const forced = await applyScaffold(plan, { force: true })
  assert.ok(forced.createdDirs.length > 0)
})

test('init：目标目录不存在时会创建它', async () => {
  const target = join(await mkdtemp(join(tmpdir(), 'pko-parent-')), 'brand-new', 'vault')
  await applyScaffold(await planScaffold(target))
  assert.equal(await hasVaultMarker(target), true, '应把新目录建出来并放好标记')
})

test('status：非知识库目录如实报告', async () => {
  const root = await tempDir()
  const status = await vaultStatus(root)
  assert.equal(status.isVault, false)
  assert.equal(status.pages, 0)
  assert.ok(status.missingDirs.length > 0, '应报告缺失的标准目录')
})

test('status：初始化后页面数等于种子知识页（不含元数据文件）', async () => {
  const root = await tempDir()
  await applyScaffold(await planScaffold(root))
  const status = await vaultStatus(root)
  // HOME + 2 个 MOC + hot + index + log + purpose + 5 个 brain = 12 页；其中元数据仍计入 pages
  assert.ok(status.pages >= 10, `页面数应不少于 10，实际 ${status.pages}`)
})

test('init：种子内容能被正常检索', async () => {
  const root = await tempDir()
  await applyScaffold(await planScaffold(root))
  const { retrieve } = await import('../packages/core/src/retrieve.ts')
  const result = await retrieve(root, '工作总览')
  assert.ok(result.candidates.some((page) => page.path.includes('moc-work')), '应能检索到工作 MOC')
})
