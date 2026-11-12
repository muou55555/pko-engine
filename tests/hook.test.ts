/** hook 的关键契约：工具名大小写、只归一化知识页。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runHook } from '../packages/core/src/hook.ts'
import { retrieve } from '../packages/core/src/retrieve.ts'

async function makeVault(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pko-hook-'))
  await mkdir(join(root, '50-Wiki'), { recursive: true })
  await mkdir(join(root, '.raw'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text)
  }
  return root
}

test('hook：Claude Code 的大写工具名同样触发拦截', async () => {
  const root = await makeVault({ '.raw/a.md': '原始材料' })
  for (const name of ['Edit', 'Write', 'MultiEdit']) {
    const outcome = await runHook(JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: name, tool_input: { file_path: join(root, '.raw', 'a.md') },
    }), { vault: root })
    assert.equal(outcome.exit, 2, `${name} 应被拦截`)
  }
})

test('hook：大写 Bash 同样触发删除拦截', async () => {
  const root = await makeVault()
  const outcome = await runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm notes.md' },
  }), { vault: root })
  assert.equal(outcome.exit, 2)
})

test('hook：PostToolUse 不给 log.md 加 frontmatter', async () => {
  const original = '# 操作日志\n\n- [2026-11-12 10:00] ingest 三页\n'
  const root = await makeVault({ '50-Wiki/log.md': original })
  await runHook(JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(root, '50-Wiki', 'log.md') },
  }), { vault: root })
  assert.equal(await readFile(join(root, '50-Wiki', 'log.md'), 'utf8'), original)
})

test('hook：PostToolUse 不碰非 markdown 文件', async () => {
  const original = '%PDF-1.7 binary'
  const root = await makeVault({ '60-Outputs/report.pdf': original })
  await runHook(JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(root, '60-Outputs', 'report.pdf') },
  }), { vault: root })
  assert.equal(await readFile(join(root, '60-Outputs', 'report.pdf'), 'utf8'), original)
})

test('hook：hot.md 不被自动归一化', async () => {
  const original = '# Hot\n\n近期上下文\n'
  const root = await makeVault({ '50-Wiki/hot.md': original })
  await runHook(JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(root, '50-Wiki', 'hot.md') },
  }), { vault: root })
  assert.equal(await readFile(join(root, '50-Wiki', 'hot.md'), 'utf8'), original)
})

test('检索：hot.md 不进检索面', async () => {
  const root = await makeVault({
    '50-Wiki/hot.md': '# Hot\n\n主题词 在缓存里\n',
    '40-Resources/c.md': '---\nid: c\ntitle: C\ntype: note\ntier: supporting\n---\n\n主题词 在正文里\n',
  })
  const result = await retrieve(root, '主题词', { deep: true })
  assert.equal(result.candidates.some((candidate) => candidate.path === '50-Wiki/hot.md'), false)
  assert.equal(result.candidates.some((candidate) => candidate.id === 'c'), true)
})
