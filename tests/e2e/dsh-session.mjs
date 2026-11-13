#!/usr/bin/env node
/**
 * 真实 DSH 会话 E2E。
 *
 * 设计原则：**只断言确定性证据**，不断言模型说了什么。
 *   - 注入是否发生 → 看事件流里有没有我们的标记文本
 *   - 拒绝是否生效 → 看文件是否原封不动
 *   - 归一化是否跑过 → 看模型明确说不写的字段是否出现
 *
 * 需要：dsh CLI 可用 + 已认证的模型路由。缺任一条件时脚本以 BLOCKED 退出（不当作失败）。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CLI = join(ROOT, 'packages/core/src/cli.ts')
const TASK_TIMEOUT_MS = 240_000

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === undefined ? '' : ` —— ${detail}`}`)
}

/** 建夹具 vault。 */
async function prepare(dir) {
  const vault = join(dir, 'vault')
  await mkdir(join(vault, '50-Wiki'), { recursive: true })
  await mkdir(join(vault, '.raw'), { recursive: true })
  await mkdir(join(vault, '40-Resources/concepts'), { recursive: true })
  await mkdir(join(vault, '00-Inbox'), { recursive: true })
  await writeFile(join(vault, '50-Wiki/hot.md'), '# Hot\n\n正在验证 PKO 引擎的 DSH 会话接入\n')
  await writeFile(join(vault, '50-Wiki/index.md'), '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n\n- [[cache-penetration]] — 缓存穿透\n')
  await writeFile(join(vault, '40-Resources/concepts/cache-penetration.md'), '---\nid: cache-penetration\ntitle: 缓存穿透\ntype: note\ntier: core\ntags: [cache]\nsummary: 布隆过滤器与空值缓存\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 缓存穿透\n\n布隆过滤器 + 空值缓存。\n')
  await writeFile(join(vault, '.raw/source.md'), '原始材料，不允许修改\n')

  const hooks = {
    hooks: {
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] }],
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] }],
      PreToolUse: [
        { matcher: 'write|edit', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] },
        { matcher: 'bash', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] },
      ],
      PostToolUse: [{ matcher: 'write|edit', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: `node ${CLI} hook --vault ${vault}` }] }],
    },
  }
  await writeFile(join(dir, 'hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`)
  await writeFile(join(dir, 'overlay.yml'), [
    '- insert:',
    '    - id: pko-e2e-hooks',
    "      name: '@deepseek-ai/dsh-hooks-claude-code'",
    '      config:',
    `        configPath: ${join(dir, 'hooks.json')}`,
    '',
  ].join('\n'))
  return { vault, overlay: join(dir, 'overlay.yml') }
}

/** 跑一次 headless 会话，返回 stdout。 */
function runSession(cwd, overlay, task) {
  const result = spawnSync('dsh', ['--profile', 'headless', '--patch', overlay, '--json', task], {
    cwd,
    encoding: 'utf8',
    timeout: TASK_TIMEOUT_MS,
    env: { ...process.env },
  })
  const stderr = result.stderr ?? ''
  if (/MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(stderr)) {
    return { blocked: stderr.split('\n').find((line) => /MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(line)) ?? 'auth' }
  }
  return { blocked: null, stdout: result.stdout ?? '', stderr, status: result.status ?? 0 }
}

const dir = await mkdtemp(join(tmpdir(), 'pko-e2e-'))
const { vault, overlay } = await prepare(dir)
console.log(`夹具 vault: ${vault}\n`)

let blocked = null
let exitCode = 0

try {
  // ---- 会话 A：正常流程（注入 + 写入 + 归一化）----
  console.log('▸ 会话 A：注入 + 正常写入')
  const a = runSession(vault, overlay, [
    '请做两件事：',
    '1) 读取 40-Resources/concepts/cache-penetration.md；',
    '2) 用 write 工具在 00-Inbox/session-note.md 写一条笔记。',
    '要求：文件内容必须是纯 Markdown 正文，**不要写任何 YAML frontmatter**。写完只回一句“完成”。',
  ].join('\n'))

  if (a.blocked !== null) {
    blocked = a.blocked
  } else {
    record('SessionStart 注入到事件流', a.stdout.includes('[知识库] 本工作区有 PKO vault'))
    record('UserPromptSubmit 注入任务相关页', a.stdout.includes('[知识库提示]') && a.stdout.includes('cache-penetration'))

    const notePath = join(vault, '00-Inbox/session-note.md')
    const noteExists = await stat(notePath).then(() => true).catch(() => false)
    record('正常写入被放行', noteExists)
    if (noteExists) {
      const note = await readFile(notePath, 'utf8')
      // 模型被明确要求不写 frontmatter，出现 type/created 只可能来自我们的 PostToolUse
      record('PostToolUse 自动补齐 frontmatter', /^---\n/.test(note) && /type: note/.test(note) && /created:/.test(note))
    }
    record('Stop 提示更新 hot.md', a.stdout.includes('建议更新 50-Wiki/hot.md'))

    // ---- 会话 B：拦截流程 ----
    console.log('\n▸ 会话 B：拦截对 .raw 的修改')
    const rawPath = join(vault, '.raw/source.md')
    const rawBefore = await readFile(rawPath, 'utf8')
    const b = runSession(vault, overlay, '把 .raw/source.md 的内容改成 hello，用 write 工具覆盖它。只回一句结果。')
    if (b.blocked !== null) {
      blocked = b.blocked
    } else {
      const rawAfter = await readFile(rawPath, 'utf8')
      record('PreToolUse 阻止覆盖 .raw', rawAfter === rawBefore, rawAfter === rawBefore ? '文件未变' : '文件被改写了')
      record('拒绝原因回到会话', /PKO 规则|\.raw\//.test(b.stdout))
    }
  }

  const inbox = await readdir(join(vault, '00-Inbox')).catch(() => [])
  console.log(`\n00-Inbox 产物: ${inbox.join(', ') || '(空)'}`)
} catch (error) {
  record('E2E 脚本自身异常', false, String(error))
} finally {
  if (blocked !== null) {
    console.log(`\nBLOCKED: ${blocked}`)
    exitCode = 2
  } else {
    const failed = results.filter((item) => !item.ok)
    console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`)
    if (failed.length > 0) {
      console.log(`失败现场保留在: ${dir}`)
      exitCode = 1
    } else {
      await rm(dir, { recursive: true, force: true })
      exitCode = 0
    }
  }
}

process.exit(exitCode)
