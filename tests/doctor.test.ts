/** doctor 的关键判定：孤儿页与 Dataview 覆盖。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDoctor } from '../packages/core/src/doctor.ts'

function page(id: string, title: string, extra: Record<string, string> = {}, body = '正文'): string {
  const head = ['---', `id: ${id}`, `title: ${title}`, 'type: note', 'tier: supporting']
  for (const [key, value] of Object.entries(extra)) head.push(`${key}: ${value}`)
  head.push('---', '', body, '')
  return head.join('\n')
}

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-doctor-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text)
  }
  return root
}

test('doctor：无入链的页面报孤儿', async () => {
  const root = await makeVault({
    '20-Projects/work/solo.md': page('solo', '孤立项目', { status: 'active' }),
  })
  const report = await runDoctor(root)
  assert.equal(report.findings.some((finding) => finding.code === 'I_ORPHAN'), true)
})

test('doctor：被 MOC 的 Dataview 查询覆盖时不算孤儿', async () => {
  const root = await makeVault({
    '10-Atlas/moc.md': page('moc', 'MOC', { type: 'moc' }, '```dataview\nTABLE status\nFROM "20-Projects/work"\nWHERE status = "active"\n```\n'),
    '20-Projects/work/solo.md': page('solo', '被覆盖的项目', { status: 'active' }),
  })
  const report = await runDoctor(root)
  assert.equal(report.findings.some((finding) => finding.code === 'I_ORPHAN'), false)
})

test('doctor：FROM "" 的全库查询不算覆盖（否则孤儿判定失效）', async () => {
  const root = await makeVault({
    '10-Atlas/home.md': page('home', 'HOME', {}, '```dataview\nLIST\nFROM ""\n```\n'),
    '20-Projects/work/solo.md': page('solo', '仍然孤立', { status: 'active' }),
  })
  const report = await runDoctor(root)
  assert.equal(report.findings.some((finding) => finding.code === 'I_ORPHAN'), true)
})
