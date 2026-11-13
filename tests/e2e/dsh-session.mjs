#!/usr/bin/env node
/**
 * 真实 DSH 会话 E2E：验证 @pko/dsh 插件在真实 agent 会话里的行为。
 *
 * 断言的都确定性证据：
 *   - 工具是否真被调用 → 解析 --json 事件流里的 tool_call
 *   - 闸门是否生效     → 受保护文件的字节级内容
 *   - 事件是否触发     → 技能投放这种可见副作用
 *
 * 需要：dsh CLI + 可用模型路由。缺认证时以 BLOCKED 退出（exit 2），不算失败。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN = join(ROOT, 'packages/dsh')
const PROFILE = `pko-e2e-${process.pid}`
const TASK_TIMEOUT_MS = 240_000

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === undefined ? '' : ` —— ${detail}`}`)
}

/** 跑一条 dsh 命令。 */
function dsh(args, options = {}) {
  return spawnSync('dsh', args, { encoding: 'utf8', timeout: options.timeout ?? 120_000, cwd: options.cwd, env: { ...process.env } })
}

/** 建夹具 vault。 */
async function prepare(dir) {
  const vault = join(dir, 'vault')
  await mkdir(join(vault, '50-Wiki'), { recursive: true })
  await mkdir(join(vault, '.raw'), { recursive: true })
  await mkdir(join(vault, '40-Resources'), { recursive: true })
  await writeFile(join(vault, '50-Wiki/hot.md'), '# Hot\n\n正在验证 pko 插件的 DSH 接入\n')
  await writeFile(join(vault, '50-Wiki/index.md'), '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n\n- [[cache]] — 缓存穿透\n')
  await writeFile(join(vault, '40-Resources/cache.md'), '---\nid: cache\ntitle: 缓存穿透\ntype: note\ntier: core\ntags: [cache]\nsummary: 布隆过滤器与空值缓存\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 缓存穿透\n\n布隆过滤器 + 空值缓存是两种常见解法。\n')
  await writeFile(join(vault, '.raw/source.md'), '原始材料，不允许改写\n')

  // headless 只带 llm-deepseek-account，缺凭据层与 account 服务本体，补上后可用账号路由
  const overlay = join(dir, 'overlay.yml')
  await writeFile(overlay, [
    '- insert:',
    '    - id: credentials',
    "      name: '@deepseek-ai/dsh-credentials-local'",
    '    - id: authorization',
    "      name: '@deepseek-ai/dsh-authorization'",
    '    - id: deepseek-account',
    "      name: '@deepseek-ai/dsh-deepseek-account-platform'",
    '      config: { desktopPlatform: null }',
    '    - id: agent-default-model',
    "      name: '@deepseek-ai/dsh-agent-default-model'",
    '      config: { provider: deepseek-account, model: deepseek-flash, reasoningEffort: high }',
    '',
  ].join('\n'))
  return { vault, overlay }
}

/** 解析 --json 事件流。 */
function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('dsh:') || trimmed.startsWith('[')) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // 非 JSON 行（诊断输出）忽略
    }
  }
  return events
}

/** 跑一次会话。 */
function runSession(vault, overlay, task) {
  const result = dsh(['--profile', PROFILE, '--patch', overlay, '--json', task], { cwd: vault, timeout: TASK_TIMEOUT_MS })
  const stderr = result.stderr ?? ''
  const blocked = /MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(stderr)
  return { blocked, stdout: result.stdout ?? '', stderr, events: parseEvents(result.stdout ?? '') }
}

const dir = await mkdtemp(join(tmpdir(), 'pko-e2e-'))
const { vault, overlay } = await prepare(dir)
console.log(`夹具: ${vault}\n档案: ${PROFILE}\n`)

let blocked = null
let exitCode = 0

try {
  // 建一次性 profile 并装插件
  dsh(['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config'])
  const install = dsh(['plugin', '--profile', PROFILE, 'add', `link:${PLUGIN}`], { timeout: 180_000 })
  if (install.status !== 0) throw new Error(`安装插件失败：${install.stderr}`)

  // ---- 会话 A：工具调用 + 会话注入 ----
  console.log('▸ 会话 A：让 agent 调用 pko_query')
  const a = runSession(vault, overlay, '用 pko_query 工具查一下「缓存穿透」，一句话告诉我结果。')
  if (a.blocked) {
    blocked = a.stderr.split('\n').find((line) => /MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(line)) ?? 'auth'
  } else {
    record('插件被加载（无条目激活失败）', !/did not activate/.test(a.stderr))
    const tools = a.events.filter((event) => event.type === 'tool_call').map((event) => event.tool)
    record('agent 真的调用了 pko_query', tools.includes('pko_query'), tools.join(',') || '(无工具调用)')
    const skillFile = join(vault, '.dsh', 'skills', 'pko-query', 'SKILL.md')
    record('会话开始投放了技能', await stat(skillFile).then(() => true).catch(() => false))

    // ---- 会话 C：会话注入是否真的进了模型上下文 ----
    // hot.md 里写了「正在验证 pko 插件的 DSH 接入」，库里没有别处能查到这句话。
    console.log('\n▸ 会话 C：验证会话上下文注入')
    const c = runSession(vault, overlay, '不要读取任何文件、不要调用工具，直接回答：你上下文里关于本次会话在做什么的说明是什么？引用一句原文。')
    if (c.blocked) {
      blocked = c.stderr.split('\n').find((line) => /MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(line)) ?? 'auth'
    } else {
      const answer = c.events.filter((event) => event.type === 'final').map((event) => event.text ?? '').join('\n')
      record('会话注入进入了模型上下文', /pko|接入|验证/.test(answer), answer.slice(0, 60))
    }

    // ---- 会话 B：闸门 ----
    console.log('\n▸ 会话 B：尝试改写受保护的 .raw 文件')
    const rawPath = join(vault, '.raw/source.md')
    const before = await readFile(rawPath, 'utf8')
    const b = runSession(vault, overlay, '用 write 工具把 .raw/source.md 的内容改成 hello。只回一句结果。')
    if (b.blocked) {
      blocked = b.stderr.split('\n').find((line) => /MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(line)) ?? 'auth'
    } else {
      const after = await readFile(rawPath, 'utf8')
      record('PreToolUse 阻止了 .raw 改写', after === before, after === before ? '文件未变' : '文件被改写')
      const raw = b.stdout
      record('拒绝原因出现在会话里', /PKO 规则|\.raw\//.test(raw))
    }
  }
} catch (error) {
  record('E2E 自身异常', false, String(error).slice(0, 160))
} finally {
  // 清理一次性 profile
  await rm(join(process.env.HOME ?? '', '.dsh', 'profiles', PROFILE), { recursive: true, force: true })

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
    }
  }
}

process.exit(exitCode)
