/** 性能门禁：大库下的检索与体检耗时、成本护栏按规模生效。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDoctor } from '../packages/core/src/doctor.ts'
import { retrieve } from '../packages/core/src/retrieve.ts'

/** 直接写文件造一个大库（不走写入协议，避免测试过慢）。 */
async function buildVault(pageCount: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pko-perf-${pageCount}-`))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await mkdir(join(root, '40-Resources'), { recursive: true })
  const writes: Promise<void>[] = []
  for (let index = 0; index < pageCount; index += 1) {
    const title = index === 0 ? '缓存穿透' : `普通页面 ${index}`
    const body = index === 0
      ? '布隆过滤器与空值缓存是常见解法。'.repeat(10)
      : `这是第 ${index} 页的正文。`.repeat(20)
    const text = `---\nid: p${index}\ntitle: ${title}\ntype: note\ntier: supporting\ntags: [t${index % 10}]\nsummary: 第 ${index} 页\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# ${title}\n\n${body}\n`
    writes.push(writeFile(join(root, '40-Resources', `p${index}.md`), text))
  }
  await Promise.all(writes)
  await writeFile(join(root, '50-Wiki/index.md'), '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n\n- [[p0]] — 缓存穿透\n')
  return root
}

test('性能：600 页库单次检索 < 10s，体检 < 30s', async () => {
  const root = await buildVault(600)

  const startedRetrieve = performance.now()
  const result = await retrieve(root, '缓存穿透')
  const retrieveMs = performance.now() - startedRetrieve
  assert.ok(result.candidates.length > 0)
  assert.ok(retrieveMs < 10_000, `检索耗时 ${retrieveMs.toFixed(0)}ms 超过 10s`)

  const startedDoctor = performance.now()
  const report = await runDoctor(root)
  const doctorMs = performance.now() - startedDoctor
  assert.ok(report.pages >= 600)
  assert.ok(doctorMs < 30_000, `体检耗时 ${doctorMs.toFixed(0)}ms 超过 30s`)

  console.log(`  · 600 页：检索 ${retrieveMs.toFixed(0)}ms，体检 ${doctorMs.toFixed(0)}ms`)
})

test('性能：超过护栏阈值后，标题命中不再扫正文（成本保护生效）', async () => {
  const root = await buildVault(600)
  const guarded = await retrieve(root, '缓存穿透', { guardThreshold: 500 })
  assert.equal(guarded.strategy.includes('body'), false, `策略 ${guarded.strategy} 不应包含 body`)

  const unguarded = await retrieve(root, '缓存穿透', { deep: true })
  assert.equal(unguarded.strategy.includes('body'), true)
})
