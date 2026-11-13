/** 属性测试：解析/渲染往返稳定、归一化幂等。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extraFields, normalizePage, renderPage } from '../packages/core/src/normalize.ts'
import { parseFrontmatter } from '../packages/core/src/schema.ts'
import { toPage } from '../packages/core/src/vault.ts'

/** 简单确定性伪随机，保证用例可复现。 */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

/** 生成一段含 CJK、标点、换行的正文。 */
function randomBody(random: () => number): string {
  const pieces = ['# 标题', '正文第一行', '> 引用', '| 表格 |', '- 列表项', '中'.repeat(20), 'English text', '---']
  const count = 1 + Math.floor(random() * 5)
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) lines.push(pieces[Math.floor(random() * pieces.length)] as string)
  return lines.join('\n\n')
}

test('属性：解析 → 渲染 → 再解析，结构稳定（100 组随机页面）', () => {
  const random = makeRandom(42)
  for (let index = 0; index < 100; index += 1) {
    const body = randomBody(random)
    const page = normalizePage(toPage(`p${index}.md`, body), { stem: `p${index}`, now: new Date('2026-01-01T00:00:00Z') }).page
    const rendered = renderPage(page)
    const reparsed = parseFrontmatter(rendered)
    assert.ok(reparsed !== undefined, '渲染结果必须可再次解析')
    assert.equal(reparsed.data.id, page.id)
    assert.equal(reparsed.data.title, page.title)
    assert.equal(reparsed.data.type, page.type)
    assert.equal(reparsed.body.trim(), page.body.trim(), '正文往返不得变形')
  }
})

test('属性：归一化是幂等的（第二次没有字段被改）', () => {
  const random = makeRandom(7)
  for (let index = 0; index < 50; index += 1) {
    const body = randomBody(random)
    const once = normalizePage(toPage(`q${index}.md`, body), { stem: `q${index}`, now: new Date('2026-01-01T00:00:00Z') }).page
    const twice = normalizePage(once, { stem: `q${index}`, now: new Date('2026-02-02T00:00:00Z') })
    assert.deepEqual(twice.changed, [], `第 ${index} 组第二次归一化仍有改动：${twice.changed.join(',')}`)
    assert.equal(renderPage(twice.page), renderPage(once), '幂等归一化后渲染必须一致')
  }
})

test('属性：非契约字段在往返中不丢失', () => {
  const random = makeRandom(99)
  for (let index = 0; index < 30; index += 1) {
    const key = `custom${Math.floor(random() * 1000)}`
    const text = `---\nid: x\ntitle: X\ntype: note\n${key}: 值-${index}\n---\n\n正文\n`
    const page = normalizePage(toPage('x.md', text), { stem: 'x' }).page
    const parsed = parseFrontmatter(text)
    const rendered = renderPage(page, extraFields(parsed?.data))
    assert.match(rendered, new RegExp(`${key}: 值-${index}`), '自定义字段必须保留')
  }
})
