/** 技能契约：frontmatter 合法、名字与目录一致、正文非空。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '../packages/core/src/schema.ts'

const SKILLS = fileURLToPath(new URL('../packages/skills', import.meta.url))
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

test('技能：每个 SKILL.md 的 frontmatter 合法且名字与目录一致', async () => {
  const entries = (await readdir(SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  assert.ok(entries.length >= 8, `技能数量不足：${entries.length}`)
  for (const entry of entries) {
    const text = await readFile(join(SKILLS, entry.name, 'SKILL.md'), 'utf8')
    const parsed = parseFrontmatter(text)
    assert.ok(parsed !== undefined, `${entry.name} 缺 frontmatter`)
    const name = parsed.data.name
    const description = parsed.data.description
    assert.equal(typeof name, 'string', `${entry.name} 缺 name`)
    assert.equal(name, entry.name, `${entry.name} 的 name 与目录不一致`)
    assert.match(String(name), KEBAB, `${entry.name} 不是 kebab-case`)
    assert.equal(typeof description, 'string', `${entry.name} 缺 description`)
    assert.ok(String(description).length >= 10, `${entry.name} 的 description 太短`)
    assert.equal(parsed.data['user-invocable'], 'true', `${entry.name} 应为人类可调用`)
    assert.ok(parsed.body.length > 80, `${entry.name} 正文太短`)
    assert.match(parsed.body, /^# /m, `${entry.name} 缺一级标题`)
  }
})

test('技能：没有重复名字', async () => {
  const entries = (await readdir(SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  const names = new Set(entries.map((entry) => entry.name))
  assert.equal(names.size, entries.length)
})

test('技能：命令式技能不占用模型 catalog', async () => {
  const entries = (await readdir(SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  for (const entry of entries) {
    const text = await readFile(join(SKILLS, entry.name, 'SKILL.md'), 'utf8')
    const parsed = parseFrontmatter(text)
    assert.equal(parsed?.data['disable-model-invocation'], 'true', `${entry.name} 应设 disable-model-invocation`)
  }
})
