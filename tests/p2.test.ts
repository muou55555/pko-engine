/** P2 回归测试：分词 / 分层检索 / 三档上下文 / UserPromptSubmit 钩子。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { clipToTokens, estimateTokens, tokenizeQuery } from '../packages/core/src/tokens.ts'
import { retrieve } from '../packages/core/src/retrieve.ts'
import { bodyContext, sessionContext, taskContext } from '../packages/core/src/context.ts'
import { runHook } from '../packages/core/src/hook.ts'

/** 拼一个带 frontmatter 的页面。 */
function page(id: string, title: string, body: string, extra: Record<string, string> = {}): string {
  const head = ['---', `id: ${id}`, `title: ${title}`, 'type: note', 'tier: supporting']
  for (const [key, value] of Object.entries(extra)) head.push(`${key}: ${value}`)
  head.push('---', '', body, '')
  return head.join('\n')
}

/** 建一个临时 vault。 */
async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-p2-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await mkdir(join(root, 'brain'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text)
  }
  return root
}

test('分词：中文按 2 字滑窗切 bigram，两字词不被丢掉', () => {
  assert.deepEqual(tokenizeQuery('Cron 时区'), ['cron', '时区'])
  assert.deepEqual(tokenizeQuery('分布式训练'), ['分布', '布式', '式训', '训练'])
  assert.deepEqual(tokenizeQuery('   '), [])
})

test('token 估算与预算裁剪', () => {
  assert.equal(estimateTokens('中文'), 2)
  const long = '中'.repeat(1000)
  const clipped = clipToTokens(long, 100)
  assert.equal(clipped.clipped, true)
  assert.ok(estimateTokens(clipped.text) <= 140)
})

test('检索：标题命中优先；仅当页面数超过护栏阈值才跳过正文', async () => {
  const root = await makeVault({
    '40-Resources/concepts/a.md': page('a', '分布式训练', '无关正文'),
    '40-Resources/concepts/b.md': page('b', '普通页', '这里提到分布式训练'),
  })
  // 默认阈值 500：小库不启用护栏，正文命中照常返回
  const normal = await retrieve(root, '分布式')
  assert.equal(normal.candidates[0]?.id, 'a')
  assert.equal(normal.candidates[0]?.matchedBy, 'title')
  assert.equal(normal.candidates.some((candidate) => candidate.id === 'b'), true)

  // 强制护栏：只留前置层命中
  const guarded = await retrieve(root, '分布式', { guardThreshold: 0 })
  assert.equal(guarded.candidates.some((candidate) => candidate.id === 'b'), false)
})

test('检索：deep 模式关闭护栏后可命中正文', async () => {
  const root = await makeVault({
    '40-Resources/concepts/a.md': page('a', '分布式训练', '无关正文'),
    '40-Resources/concepts/b.md': page('b', '普通页', '这里提到分布式训练'),
  })
  const result = await retrieve(root, '分布式', { deep: true })
  const body = result.candidates.find((candidate) => candidate.id === 'b')
  assert.equal(body?.matchedBy, 'body')
})

test('检索：index-only 只返回 index.md 里的条目', async () => {
  const root = await makeVault({
    '50-Wiki/index.md': '# 目录\n\n- [[c]] — 目录条目\n',
    '40-Resources/concepts/c.md': page('c', '无关标题', '目录 出现在正文'),
  })
  const result = await retrieve(root, '目录', { mode: 'index-only' })
  assert.equal(result.strategy, 'index')
  assert.equal(result.candidates[0]?.id, 'c')
  assert.equal(result.candidates[0]?.matchedBy, 'index')
})

test('检索：正文命中页的一跳邻居作为 graph 候选', async () => {
  const root = await makeVault({
    '40-Resources/concepts/x.md': page('x', '甲', '这里讲关键词甲\n\n见 [[y]]'),
    '40-Resources/concepts/y.md': page('y', '乙', '无关内容'),
  })
  const result = await retrieve(root, '关键词甲')
  const neighbor = result.candidates.find((candidate) => candidate.id === 'y')
  assert.equal(neighbor?.matchedBy, 'graph')
})

test('上下文：会话档包含 hot.md 且不超预算', async () => {
  const root = await makeVault({
    '50-Wiki/hot.md': `# Hot\n\n${'上下文内容。'.repeat(60)}`,
    'brain/north-star.md': '# 目标\n\n完成 P2',
  })
  const context = await sessionContext(root, { maxTokens: 120 })
  assert.ok(context !== undefined)
  assert.match(context.text, /PKO vault/)
  assert.ok(context.tokens <= 140)
  assert.deepEqual([...context.sources].sort(), ['50-Wiki/hot.md', 'brain/north-star.md'])
})

test('上下文：任务档最多 3 条，零命中时不说话', async () => {
  const root = await makeVault({
    '40-Resources/concepts/1.md': page('p1', '知识点一', '主题词 出现在这里'),
    '40-Resources/concepts/2.md': page('p2', '知识点二', '主题词 出现在这里'),
    '40-Resources/concepts/3.md': page('p3', '知识点三', '主题词 出现在这里'),
    '40-Resources/concepts/4.md': page('p4', '知识点四', '主题词 出现在这里'),
  })
  const context = await taskContext(root, '主题词')
  assert.ok(context !== undefined)
  const bullets = context.text.split('\n').filter((line) => line.startsWith('- '))
  assert.ok(bullets.length > 0 && bullets.length <= 3)

  const none = await taskContext(root, '完全无关的词组')
  assert.equal(none, undefined)
})

test('上下文：整页档返回指定页正文', async () => {
  const root = await makeVault({
    '40-Resources/concepts/z.md': page('z', '整页测试', '这是整页正文内容'),
  })
  const context = await bodyContext(root, 'z')
  assert.ok(context !== undefined)
  assert.match(context.text, /这是整页正文内容/)
})

test('hook UserPromptSubmit 注入任务级提示', async () => {
  const root = await makeVault({
    '40-Resources/concepts/q.md': page('q', '缓存穿透', '缓存穿透的常见解法'),
  })
  const outcome = await runHook(JSON.stringify({
    hook_event_name: 'UserPromptSubmit', prompt: '缓存穿透怎么处理',
  }), { vault: root })
  assert.equal(outcome.exit, 0)
  assert.match(outcome.stdout, /知识库提示/)
  assert.match(outcome.stdout, /缓存穿透/)
})

test('检索：index.md / log.md 不进检索面，无标题页用文件名兜底', async () => {
  const root = await makeVault({
    '50-Wiki/index.md': '# 目录\n\n主题词 出现在索引里\n',
    '50-Wiki/log.md': '# 日志\n\n主题词 出现在日志里\n',
    '40-Resources/concepts/untitled.md': '---\nid: untitled\ntype: note\n---\n\n主题词 在这里\n',
  })
  const result = await retrieve(root, '主题词', { deep: true })
  assert.equal(result.candidates.some((candidate) => candidate.path === '50-Wiki/index.md'), false)
  assert.equal(result.candidates.some((candidate) => candidate.path === '50-Wiki/log.md'), false)
  const untitled = result.candidates.find((candidate) => candidate.id === 'untitled')
  assert.equal(untitled?.title, 'untitled')
})

test('token 预算：裁剪后永不超限（含截断标记）', () => {
  for (const budget of [10, 50, 100, 400]) {
    for (const text of ['中'.repeat(5000), 'a'.repeat(5000), '中文abc混合'.repeat(300)]) {
      const clipped = clipToTokens(text, budget)
      assert.ok(estimateTokens(clipped.text) <= budget, `budget=${budget} 超限`)
    }
  }
})

test('检索：index 里的短链接不按路径前缀误配', async () => {
  const root = await makeVault({
    '50-Wiki/index.md': '- [[a]] — 短链接\n',
    'articles/foo.md': page('foo', '文章', '内容'),
  })
  const result = await retrieve(root, '短链接', { mode: 'index-only' })
  assert.deepEqual(result.candidates, [])
})

test('分词：纯标点不产生检索词', () => {
  assert.deepEqual(tokenizeQuery('???'), [])
})
