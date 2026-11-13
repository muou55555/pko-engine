/** @pko/dsh 插件接线：工具注册、事件订阅、闸门决策。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Config, apply } from '../packages/dsh/src/index.ts'
import { readConfig } from '../packages/dsh/src/config.ts'

interface RegisteredTool { name: string; description: string }

/** 造一个记录调用的假宿主。 */
function makeHost(): {
  ctx: {
    tools: { register(definition: RegisteredTool & Record<string, unknown>): () => void }
    on(event: string, handler: (...args: never[]) => unknown): () => void
    logger: { info(message: string): void; warn(message: string): void }
  }
  tools: RegisteredTool[]
  handlers: Map<string, (...args: never[]) => unknown>
  warnings: string[]
} {
  const tools: RegisteredTool[] = []
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const warnings: string[] = []
  const ctx = {
    tools: {
      register(definition: RegisteredTool & Record<string, unknown>): () => void {
        tools.push(definition)
        return () => undefined
      },
    },
    on(event: string, handler: (...args: never[]) => unknown): () => void {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    logger: {
      info(): void { /* 忽略 */ },
      warn(message: string): void { warnings.push(message) },
    },
  }
  return { ctx, tools, handlers, warnings }
}

async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-dsh-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await mkdir(join(root, '.raw'), { recursive: true })
  await writeFile(join(root, '.raw/source.md'), '原始材料')
  return root
}

test('dsh 插件：注册 10 个工具且无重名', () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const names = host.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    'pko_capture', 'pko_checkpoint', 'pko_context', 'pko_ingest', 'pko_init',
    'pko_lint', 'pko_normalize', 'pko_query', 'pko_read', 'pko_status',
  ])
  assert.equal(new Set(names).size, names.length)
})

test('dsh 插件：每个工具都带 output.render 与 JSON Schema', () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  for (const tool of host.tools) {
    const record = tool as unknown as { parameters: unknown; output: { schema: unknown; render: unknown } }
    assert.equal(typeof record.output.render, 'function', `${tool.name} 缺 render`)
    assert.equal(typeof record.parameters, 'object', `${tool.name} 缺 parameters`)
    assert.equal(typeof record.output.schema, 'object', `${tool.name} 缺 output.schema`)
  }
})

test('dsh 插件：默认只订阅会话与写入闸门（召回默认关闭）', () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  assert.equal(host.handlers.has('agent/created'), true)
  assert.equal(host.handlers.has('agent/pre-step'), false, 'trigger 默认关闭时不订阅召回')
  assert.equal(host.handlers.has('tools/pre-execute'), true)
})

test('dsh 插件：trigger=true 时额外订阅 agent/pre-step', () => {
  const host = makeHost()
  apply(host.ctx as never, { trigger: true })
  assert.equal(host.handlers.has('agent/pre-step'), true)
})

test('dsh 插件：关掉闸门后不再订阅 pre-execute', () => {
  const host = makeHost()
  apply(host.ctx as never, { guard: false })
  assert.equal(host.handlers.has('tools/pre-execute'), false)
  assert.equal(host.handlers.has('agent/created'), true)
})

test('dsh 插件：编辑 .raw 被拒绝', async () => {
  const host = makeHost()
  const root = await makeVault()
  apply(host.ctx as never, { vault: root })
  const handler = host.handlers.get('tools/pre-execute') as (
    exec: { name: string; arguments: Record<string, unknown> },
    next: () => Promise<unknown>,
  ) => Promise<unknown>
  const decision = await handler(
    { name: 'edit', arguments: { file_path: join(root, '.raw/source.md') } },
    async () => ({ kind: 'enter' }),
  )
  assert.deepEqual(decision, { kind: 'deny', reason: (decision as { reason: string }).reason })
  assert.match((decision as { reason: string }).reason, /\.raw\//)
})

test('dsh 插件：删除命令被拒绝，正常写入放行', async () => {
  const host = makeHost()
  const root = await makeVault()
  apply(host.ctx as never, { vault: root })
  const handler = host.handlers.get('tools/pre-execute') as (
    exec: { name: string; arguments: Record<string, unknown> },
    next: () => Promise<unknown>,
  ) => Promise<unknown>

  const denied = await handler({ name: 'bash', arguments: { command: 'rm -rf .' } }, async () => ({ kind: 'enter' }))
  assert.equal((denied as { kind: string }).kind, 'deny')

  const allowed = await handler(
    { name: 'write', arguments: { file_path: join(root, '40-Resources/x.md') } },
    async () => ({ kind: 'enter' }),
  )
  assert.equal((allowed as { kind: string }).kind, 'enter')
})


test('pko_read：id / 文件名 / 相对路径三种写法都能读到', async () => {
  const host = makeHost()
  const root = await makeVault()
  apply(host.ctx as never, { vault: root })
  const read = host.tools.find((tool) => tool.name === 'pko_read') as unknown as {
    execute(args: Record<string, unknown>, exec: unknown): Promise<{ path: string }>
  }
  const rel = '40-Resources/concepts/target.md'
  await mkdir(join(root, '40-Resources', 'concepts'), { recursive: true })
  await writeFile(join(root, rel), '---\nid: target\ntitle: 靶页\ntype: note\ntier: supporting\n---\n\n正文\n')
  for (const key of ['target', 'target.md', rel, `./${rel}`]) {
    const page = await read.execute({ id: key }, {})
    assert.equal(page.path, rel, `${key} 应能定位到页面`)
  }
})


/** 用指定 cwd 调一个工具。 */
async function callTool(host: ReturnType<typeof makeHost>, name: string, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const tool = host.tools.find((candidate) => candidate.name === name) as unknown as {
    execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
  }
  return tool.execute(args, { agent: { session: { header: { cwd } } } })
}

test('pko_status：非知识库目录也能调用，如实报告', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-novault-'))
  const status = await callTool(host, 'pko_status', {}, dir) as { isVault: boolean; missingDirs: string[] }
  assert.equal(status.isVault, false)
  assert.ok(status.missingDirs.length > 0)
})

test('pko_init：空目录里初始化出可用的知识库', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-init-'))

  const result = await callTool(host, 'pko_init', {}, dir) as { createdDirs: number; createdFiles: number }
  assert.ok(result.createdDirs > 0, '应创建目录')
  assert.ok(result.createdFiles > 0, '应写入种子文件')

  const status = await callTool(host, 'pko_status', {}, dir) as { isVault: boolean; pages: number }
  assert.equal(status.isVault, true, '初始化后应能识别为知识库')
  assert.ok(status.pages > 0)
})

test('pko_init：非空目录需 force，否则给出可操作的报错', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-init-guard-'))
  await writeFile(join(dir, 'random.txt'), 'x')

  await assert.rejects(() => callTool(host, 'pko_init', {}, dir), /force: true/)
  const forced = await callTool(host, 'pko_init', { force: true }, dir) as { createdDirs: number }
  assert.ok(forced.createdDirs > 0)
})

test('工具在无 vault 时报错会指引初始化', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-novault2-'))
  await assert.rejects(() => callTool(host, 'pko_lint', {}, dir), /pko_init/)
})


test('pko_init：可以指定目标目录，不必是当前目录', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const cwd = await mkdtemp(join(tmpdir(), 'pko-cwd-'))
  const target = join(await mkdtemp(join(tmpdir(), 'pko-parent-')), 'nested-vault')

  const result = await callTool(host, 'pko_init', { path: target }, cwd) as { target: string; createdDirs: number }
  assert.equal(result.target, target)
  assert.ok(result.createdDirs > 0)

  const status = await callTool(host, 'pko_status', {}, target) as { isVault: boolean }
  assert.equal(status.isVault, true)
})

test('pko_init：已有部分结构时补齐，不重建', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-partial-'))
  await mkdir(join(dir, '50-Wiki'), { recursive: true })
  await writeFile(join(dir, '50-Wiki/hot.md'), '# 我的热缓存\n', 'utf8')

  const result = await callTool(host, 'pko_init', {}, dir) as { createdDirs: number; missingDirs: number }
  assert.ok(result.createdDirs > 0, '应补齐缺失目录')
  assert.equal(result.missingDirs, 0, '补齐后不应再有缺失')
  const hot = await (await import('node:fs/promises')).readFile(join(dir, '50-Wiki/hot.md'), 'utf8')
  assert.equal(hot, '# 我的热缓存\n', '不得覆盖用户已有文件')
})


test('pko_init：结构完整时明确宣告"库已就绪，无需再检查"', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const tool = host.tools.find((candidate) => candidate.name === 'pko_init') as unknown as {
    output: { render(args: Record<string, unknown>, value: unknown): Array<{ text: string }> }
  }

  const ready = tool.output.render({}, { target: '/x', createdDirs: 38, createdFiles: 13, skipped: 0, missingDirs: 0 })
  assert.match(ready[0]?.text ?? '', /库已就绪，无需再检查/)
  assert.match(ready[0]?.text ?? '', /不要再用 pko_status/)

  const incomplete = tool.output.render({}, { target: '/x', createdDirs: 5, createdFiles: 1, skipped: 0, missingDirs: 3 })
  assert.doesNotMatch(incomplete[0]?.text ?? '', /库已就绪/, '结构不完整时不得宣告就绪')
  assert.match(incomplete[0]?.text ?? '', /仍有 3 个标准目录缺失/)
})

test('pko_init：真跑一次后 missingDirs 为 0（能触发就绪分支）', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-ready-'))
  const result = await callTool(host, 'pko_init', {}, dir) as { missingDirs: number; isVault: boolean }
  assert.equal(result.missingDirs, 0)
  assert.equal(result.isVault, true)
})


test('pko_init：plan=true 只预览、不写盘', async () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const dir = await mkdtemp(join(tmpdir(), 'pko-plan-'))

  const preview = await callTool(host, 'pko_init', { plan: true }, dir) as { dryRun: boolean; plannedDirs: number; plannedFiles: number }
  assert.equal(preview.dryRun, true)
  assert.ok(preview.plannedDirs > 0, '应报告将创建的目录数')
  assert.ok(preview.plannedFiles > 0, '应报告将创建的文件数')

  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(dir), [], '预览模式不得写盘')

  const real = await callTool(host, 'pko_init', {}, dir) as { createdDirs: number }
  assert.ok(real.createdDirs > 0, '确认后才真正创建')
})


test('配置 schema：导出的 Config 与运行时默认值一致（设置页表单的来源）', () => {
  const resolved = Config({}) as Record<string, unknown>
  assert.equal(resolved.vault, '')
  assert.equal(resolved.sessionContext, false)
  assert.equal(resolved.trigger, false)
  assert.equal(resolved.guard, true)
  assert.equal(resolved.installSkills, true)
  assert.equal(resolved.maxInjectTokens, 400)

  const parsed = readConfig(resolved)
  assert.equal(parsed.sessionContext, false)
  assert.equal(parsed.trigger, false)
  assert.equal(parsed.guard, true)
})
