/** 00-Inbox 完成标记：只改 status，不动正文。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInboxPath, markStatusDone } from '../packages/core/src/inbox.ts'

test('inbox：识别 00-Inbox 路径', () => {
  assert.equal(isInboxPath('00-Inbox/缓存穿透.md'), true)
  assert.equal(isInboxPath('./00-Inbox/a.md'), true)
  assert.equal(isInboxPath('00-Inbox-x/a.md'), false)
  assert.equal(isInboxPath('40-Resources/a.md'), false)
})

test('inbox：有 frontmatter 时只改 status 这一行', () => {
  const text = '---\nid: x\ntitle: 标题\nstatus: draft\ntags: [a]\n---\n\n正文内容\n'
  const out = markStatusDone(text)
  assert.match(out, /status: done/)
  assert.doesNotMatch(out, /status: draft/)
  assert.match(out, /正文内容/)
  assert.match(out, /title: 标题/)
  assert.match(out, /tags: \[a\]/)
})

test('inbox：没有 status 字段时补一行', () => {
  const text = '---\ntitle: 标题\n---\n\n正文\n'
  const out = markStatusDone(text)
  assert.match(out, /status: done/)
  assert.match(out, /title: 标题/)
  assert.match(out, /正文/)
})

test('inbox：没有 frontmatter 时在顶部插入最小块，正文不动', () => {
  const text = '# 原始笔记\n\n一段内容\n'
  const out = markStatusDone(text)
  assert.equal(out, '---\nstatus: done\n---\n# 原始笔记\n\n一段内容\n')
})

test('inbox：已经是 done 时字节不变', () => {
  const text = '---\nstatus: done\n---\n\n正文\n'
  assert.equal(markStatusDone(text), text)
})
