/** DSH 插件的事件接线：会话注入、任务召回、配置开关、技能投放。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../packages/dsh/src/index.ts'
import { nearestVault, resolveVault } from '../packages/dsh/src/vault.ts'
import { readConfig } from '../packages/dsh/src/config.ts'
import { userNotice } from '../packages/dsh/src/notice.ts'

interface Captured { readonly text: string }

/** 假宿主：记录 handler 与注入的消息。 */
function makeHost(): {
  ctx: Record<string, unknown>
  handlers: Map<string, (...args: never[]) => unknown>
  injected: Captured[]
  warnings: string[]
} {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const injected: Captured[] = []
  const warnings: string[] = []
  const ctx = {
    tools: { register: () => () => undefined },
    on(event: string, handler: (...args: never[]) => unknown): () => void {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    logger: { info(): void { /* 忽略 */ }, warn(message: string): void { warnings.push(message) } },
  }
  return { ctx, handlers, injected, warnings }
}

/** 造一个最小 vault。 */
async function makeVault(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-ev-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel)
    await mkdir(join(abs, '..'), { recursive: true }).catch(() => undefined)
    await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true })
    await writeFile(abs, text)
  }
  return root
}

/** 从注入的消息里取纯文本。 */
function textOf(message: unknown): string {
  const content = (message as { content?: Array<{ text?: string }> }).content ?? []
  return content.map((block) => block.text ?? '').join('')
}

test('vault 解析：向上找到含索引的 vault 根', async () => {
  const root = await makeVault({ '50-Wiki/index.md': '# 索引\n' })
  const deep = join(root, '30-Areas', 'work')
  await mkdir(deep, { recursive: true })
  assert.equal(nearestVault(deep), root)
  assert.equal(resolveVault(undefined, deep), root)
})

test('vault 解析：配置固定路径优先，不存在则返回 undefined', async () => {
  const root = await makeVault({ '50-Wiki/index.md': '# 索引\n' })
  assert.equal(resolveVault(root, '/tmp'), root)
  assert.equal(resolveVault('/tmp/definitely-not-a-vault-xyz', '/tmp'), undefined)
})

test('vault 解析：只有 50-Wiki 目录、没有 index.md 也能识别', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pko-nowiki-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  assert.equal(nearestVault(root), root)
})

test('vault 解析：完全不在库内时返回 undefined', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'pko-empty-'))
  assert.equal(nearestVault(empty), undefined)
})

test('配置：缺省值正确，非法值被收敛', () => {
  assert.deepEqual(readConfig(undefined), { trigger: false, guard: true, installSkills: true, sessionContext: false, maxInjectTokens: 400 })
  const parsed = readConfig({ vault: '  ', trigger: 'no', guard: 1, installSkills: false, maxInjectTokens: 10 })
  assert.equal(parsed.vault, undefined, '空字符串不应当作路径')
  assert.equal(parsed.trigger, false, '非布尔值回落默认（关闭）')
  assert.equal(parsed.guard, true)
  assert.equal(parsed.installSkills, false)
  assert.equal(parsed.maxInjectTokens, 50, '预算下限为 50')
})

test('消息构造：形状符合宿主 user 消息契约', () => {
  const message = userNotice('测试文本')
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.deepEqual(message.source, { kind: 'user' })
  assert.deepEqual(message.content, [{ type: 'text', text: '测试文本' }])
})

test('事件：会话开始注入 hot.md 并投放技能', async () => {
  const vault = await makeVault({ '50-Wiki/hot.md': '# Hot\n\n正在做 DSH 接入验证\n' })
  const host = makeHost()
  apply(host.ctx as never, { vault, sessionContext: true })
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<void>

  const injected: string[] = []
  await handler({
    agent: {
      inject: (message: unknown) => { injected.push(textOf(message)) },
      session: { header: { cwd: vault } },
    },
  })

  assert.equal(injected.length, 1)
  assert.match(injected[0] ?? '', /PKO vault/)
  assert.match(injected[0] ?? '', /DSH 接入验证/)
  // 技能被投放到 vault
  const skillFile = join(vault, '.dsh', 'skills', 'pko-query', 'SKILL.md')
  assert.ok((await stat(skillFile)).isFile())
})

test('事件：关闭技能投放时不再写 vault', async () => {
  const vault = await makeVault({ '50-Wiki/hot.md': '# Hot\n\n内容\n' })
  const host = makeHost()
  apply(host.ctx as never, { vault, installSkills: false, sessionContext: true })
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<void>
  await handler({ agent: { inject: () => undefined, session: { header: { cwd: vault } } } })
  await assert.rejects(() => stat(join(vault, '.dsh')), /ENOENT/)
})

test('事件：任务召回注入一次，同一任务不重复', async () => {
  const vault = await makeVault({
    '50-Wiki/hot.md': '# Hot\n\n内容\n',
    '40-Resources/cache.md': '---\nid: cache\ntitle: 缓存穿透\ntype: note\ntier: core\ntags: [cache]\nsummary: 布隆过滤器\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 缓存穿透\n\n布隆过滤器 + 空值缓存\n',
  })
  const host = makeHost()
  apply(host.ctx as never, { vault, installSkills: false, trigger: true })
  const handler = host.handlers.get('agent/pre-step') as (
    payload: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>

  const injected: string[] = []
  const agent = { inject: (message: unknown) => { injected.push(textOf(message)) }, session: { header: { cwd: vault } } }
  const decision = { kind: 'enter', messages: [{ content: [{ type: 'text', text: '缓存穿透怎么处理' }] }] }

  const first = await handler({ agent }, async () => decision)
  assert.deepEqual(first, decision, '必须原样返回宿主决策')
  assert.equal(injected.length, 1)
  assert.match(injected[0] ?? '', /缓存穿透/)

  await handler({ agent }, async () => decision)
  assert.equal(injected.length, 1, '同一任务不应重复注入')
})

test('事件：关闭 trigger 后不订阅 pre-step', () => {
  const host = makeHost()
  apply(host.ctx as never, { trigger: false })
  assert.equal(host.handlers.has('agent/pre-step'), false)
  assert.equal(host.handlers.has('agent/created'), true)
})

test('事件：注入失败不抛给宿主', async () => {
  const vault = await makeVault({ '50-Wiki/hot.md': '# Hot\n\n内容\n' })
  const host = makeHost()
  apply(host.ctx as never, { vault, installSkills: false, sessionContext: true })
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<void>
  await handler({ agent: { inject: () => { throw new Error('宿主拒绝') }, session: { header: { cwd: vault } } } })
  assert.ok(host.warnings.some((warning) => warning.includes('会话注入失败')))
})


test('事件：召回只看最新用户消息，不被历史话题带偏', async () => {
  const vault = await makeVault({
    '50-Wiki/hot.md': '# Hot\n\n内容\n',
    '40-Resources/cache.md': '---\nid: cache\ntitle: 缓存穿透\ntype: note\ntier: core\ntags: [cache]\nsummary: 布隆过滤器\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 缓存穿透\n\n布隆过滤器\n',
    '40-Resources/travel.md': '---\nid: travel\ntitle: 旅行计划\ntype: note\ntier: supporting\ntags: [travel]\nsummary: 行程安排\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 旅行计划\n\n行程安排\n',
  })
  const host = makeHost()
  apply(host.ctx as never, { vault, installSkills: false, trigger: true })
  const handler = host.handlers.get('agent/pre-step') as (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>
  const injected: string[] = []
  const agent = { inject: (message: unknown) => { injected.push(textOf(message)) }, session: { header: { cwd: vault } } }

  // 历史里聊过缓存，本轮问的是旅行：应只命中旅行页
  const decision = {
    kind: 'enter',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '之前问过缓存穿透怎么处理' }] },
      { role: 'assistant', content: [{ type: 'text', text: '布隆过滤器' }] },
      { role: 'user', content: [{ type: 'text', text: '旅行计划怎么安排' }] },
    ],
  }
  await handler({ agent }, async () => decision)
  assert.equal(injected.length, 1)
  assert.match(injected[0] ?? '', /旅行计划/)
  assert.doesNotMatch(injected[0] ?? '', /缓存穿透/, '不应被历史话题带偏')
})


test('事件：非知识库目录不注入任何提示（保持安静）', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-novault-'))
  const injected: string[] = []
  const agent = {
    inject: (message: unknown) => { injected.push(textOf(message)) },
    session: { header: { cwd: dir } },
  }
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<unknown>
  await handler({ agent })

  assert.equal(injected.length, 0, '会话开始不应主动提示安装或初始化')
})

test('事件：已经是知识库时不注入初始化提示', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-vault-'))
  await mkdir(join(dir, '50-Wiki'), { recursive: true })
  const injected: string[] = []
  const agent = {
    inject: (message: unknown) => { injected.push(textOf(message)) },
    session: { header: { cwd: dir } },
  }
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<unknown>
  await handler({ agent })

  assert.equal(injected.some((item) => item.includes('不是 PKO 知识库')), false)
})



test('事件：sessionContext=false 时不注入会话上下文，但技能照常投放', async () => {
  const host = makeHost()
  apply(host.ctx as never, { sessionContext: false })
  const dir = await mkdtemp(join(tmpdir(), 'pko-nocontext-'))
  await mkdir(join(dir, '50-Wiki'), { recursive: true })
  await writeFile(join(dir, '50-Wiki/hot.md'), '# Hot\n\n内容\n')
  const injected: string[] = []
  const agent = {
    inject: (message: unknown) => { injected.push(textOf(message)) },
    session: { header: { cwd: dir } },
  }
  const handler = host.handlers.get('agent/created') as (payload: unknown) => Promise<unknown>
  await handler({ agent })

  assert.equal(injected.length, 0, '不应注入会话上下文')
  const skills = await (await import('node:fs/promises')).readdir(join(dir, '.dsh/skills')).catch(() => [])
  assert.equal(skills.length, 9, '技能仍应被投放')
})
