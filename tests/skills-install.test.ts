/** 技能投递：只补缺、不覆盖、可重复调用。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureSkills, resolveSkillsDir } from '../packages/dsh/src/skills.ts'

test('技能投递：能把随包技能放到 vault 的 .dsh/skills', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'pko-skills-'))
  const result = ensureSkills(vault)
  assert.ok(result.installed.length >= 8, `只装了 ${result.installed.length} 个`)
  const names = await readdir(join(vault, '.dsh', 'skills'))
  assert.deepEqual(names.sort(), result.installed.sort())
  const body = await readFile(join(vault, '.dsh', 'skills', 'pko-query', 'SKILL.md'), 'utf8')
  assert.match(body, /^---\n/)
  assert.match(body, /name: pko-query/)
})

test('技能投递：第二次调用不覆盖用户改动', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'pko-skills2-'))
  ensureSkills(vault)
  const target = join(vault, '.dsh', 'skills', 'pko-query', 'SKILL.md')
  await writeFile(target, '用户定制过的内容\n')
  const second = ensureSkills(vault)
  assert.equal(second.installed.length, 0)
  assert.ok(second.skipped.includes('pko-query'))
  assert.equal(await readFile(target, 'utf8'), '用户定制过的内容\n')
})

test('技能投递：源码期能定位到 packages/skills', () => {
  const dir = resolveSkillsDir()
  assert.ok(dir !== undefined, '定位不到技能目录')
  assert.match(dir ?? '', /skills$/)
})
