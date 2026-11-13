/** @pko/dsh 插件接线：工具注册、事件订阅、闸门决策。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../packages/dsh/src/index.ts'

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

test('dsh 插件：注册 8 个工具且无重名', () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  const names = host.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    'pko_capture', 'pko_checkpoint', 'pko_context', 'pko_ingest',
    'pko_lint', 'pko_normalize', 'pko_query', 'pko_read',
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

test('dsh 插件：订阅会话、任务与写入闸门三个锚点', () => {
  const host = makeHost()
  apply(host.ctx as never, {})
  assert.equal(host.handlers.has('agent/created'), true)
  assert.equal(host.handlers.has('agent/pre-step'), true)
  assert.equal(host.handlers.has('tools/pre-execute'), true)
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
