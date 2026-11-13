#!/usr/bin/env node
/**
 * 业务闭环验证：摄取 → 检索 → 收尾 → 周报。
 *
 * 断言全部落在文件系统与事件流上，不看模型措辞。
 * 需要可用模型路由；缺认证时以 BLOCKED 退出（exit 2）。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN = join(ROOT, 'packages', 'dsh')
const PROFILE = `pko-flow-${process.pid}`
const TIMEOUT = 300_000

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === undefined ? '' : ` —— ${detail}`}`)
}

/** 跑一条命令。 */
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? TIMEOUT, cwd: options.cwd })
}

/** 解析事件流里的工具名与最终文本。 */
function parse(stdout) {
  const tools = []
  let final = ''
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const event = JSON.parse(trimmed)
      if (event.type === 'tool_call' && typeof event.tool === 'string') tools.push(event.tool)
      if (event.type === 'final' && typeof event.text === 'string') final = event.text
    } catch {
      // 非 JSON 行忽略
    }
  }
  return { tools, final }
}

/** 今天与本周的日期串。 */
function dates() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now - start) / 86_400_000 + start.getDay() + 1) / 7)
  return { today, week: `${now.getFullYear()}-W${pad(week)}` }
}

const dir = await mkdtemp(join(tmpdir(), 'pko-flow-'))
const vault = join(dir, 'vault')
const { today, week } = dates()

/**
 * 把技能正文拼进任务，等价于用户在会话里输入 /pko-xxx。
 * 技能正文是纯 Markdown，去掉 frontmatter 后就是完整的执行步骤。
 */
async function skillTask(name, task) {
  const raw = await readFile(join(ROOT, 'packages', 'skills', name, 'SKILL.md'), 'utf8')
  const body = raw.replace(/^---[\s\S]*?---\n/, '').trim()
  return `${body}\n\n---\n\n用户请求：${task}`
}

/** 跑一次会话。 */
function session(task) {
  const result = run('dsh', ['--profile', PROFILE, '--patch', join(dir, 'account.yml'), '--json', task], { cwd: vault })
  const stderr = result.stderr ?? ''
  if (/MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(stderr)) return { blocked: true, ...parse('') }
  return { blocked: false, ...parse(result.stdout ?? '') }
}

let blocked = false
let exitCode = 0

try {
  await mkdir(vault, { recursive: true })
  await writeFile(join(dir, 'account.yml'), [
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

  // 初始化知识库
  run(process.execPath, [join(ROOT, 'packages/core/src/cli.ts'), 'init', '--vault', vault])

  // 一次性 profile + 插件
  run('dsh', ['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config'])
  const install = run('dsh', ['plugin', '--profile', PROFILE, 'add', `link:${PLUGIN}`])
  if (install.status !== 0) throw new Error(`插件安装失败：${install.stderr}`)

  // ---- 1. 摄取 ----
  console.log('\n▸ 摄取：原件留在 00-Inbox + 蒸馏页 + 索引')
  await writeFile(join(vault, '00-Inbox/缓存穿透.md'), '# 缓存穿透\n\n布隆过滤器 + 空值缓存是两种常见解法。空值缓存要设短 TTL。\n')
  const ingest = session(await skillTask('pko-ingest', '处理一下 Inbox，完成后只回一句结果。'))
  if (ingest.blocked) blocked = true
  else {
    const inboxFiles = (await readdir(join(vault, '00-Inbox')).catch(() => [])).filter((name) => name.endsWith('.md'))
    record('摄取：原件留在 00-Inbox/', inboxFiles.length > 0, inboxFiles.join(',') || '(空)')

    const wikiFiles = (await readdir(join(vault, '50-Wiki')).catch(() => [])).filter((name) => name.endsWith('.md'))
    const page = wikiFiles.find((name) => name.includes('缓存'))
    const pageText = page === undefined ? '' : await readFile(join(vault, '50-Wiki', page), 'utf8')
    record('摄取：蒸馏页带 frontmatter 与 summary', /summary:/.test(pageText), page ?? '(未生成)')

    const index = await readFile(join(vault, '50-Wiki/index.md'), 'utf8')
    record('摄取：索引登记了新页', /缓存/.test(index))

    const log = await readFile(join(vault, '50-Wiki/log.md'), 'utf8')
    record('摄取：日志有记录', log.trim().split('\n').length > 1, `${log.trim().split('\n').length} 行`)
  }

  // ---- 2. 检索 ----
  console.log('\n▸ 检索：问一个只有库里才有的问题')
  const query = session(await skillTask('pko-query', '我之前记过关于缓存穿透的什么内容？用一句话回答。'))
  if (query.blocked) blocked = true
  else {
    record('检索：调用了 pko_query', query.tools.includes('pko_query'), query.tools.join(',') || '(无工具)')
    record('检索：回答带来源', /50-Wiki|缓存穿透\.md/.test(query.final), query.final.slice(0, 60))
  }

  // ---- 3. 收尾 ----
  console.log('\n▸ 收尾：追加日记 + 重写 hot.md')
  const wrap = session(await skillTask('pko-wrap-up', '做收尾。'))
  if (wrap.blocked) blocked = true
  else {
    const daily = await readFile(join(vault, '70-Calendar/daily', `${today}.md`), 'utf8').catch(() => '')
    record('收尾：今日日记存在且有会话产出', /会话产出/.test(daily), `${today}.md`)
    const hot = await readFile(join(vault, '50-Wiki/hot.md'), 'utf8')
    record('收尾：hot.md 被重写', /Last Updated/i.test(hot) && hot.includes(today), hot.split('\n')[0] ?? '')
  }

  // ---- 4. 周报 ----
  console.log('\n▸ 周报：对外版 + 个人版归档')
  const weekly = session(await skillTask('pko-weekly', `生成本周（${week}）周报，完成后只回一句。`))
  if (weekly.blocked) blocked = true
  else {
    const report = await readFile(join(vault, '60-Outputs/weekly-reports', `${week}.md`), 'utf8').catch(() => '')
    record('周报：归档到 60-Outputs/weekly-reports/', report !== '', `${week}.md`)
    record('周报：含对外版与个人版', /对外/.test(report) && /个人/.test(report))
  }

  // ---- 5. 治理 ----
  console.log('\n▸ 治理：覆写操作日志被拦')
  const logBefore = await readFile(join(vault, '50-Wiki/log.md'), 'utf8')
  const guard = session('用 write 工具把 50-Wiki/log.md 整个覆写成一行 hello。只回一句结果。')
  if (!guard.blocked) {
    const logAfter = await readFile(join(vault, '50-Wiki/log.md'), 'utf8')
    record('治理：log.md 未被整体覆写', logAfter.length >= logBefore.length)
  }
} catch (error) {
  record('流程验证自身异常', false, String(error).slice(0, 200))
} finally {
  await rm(join(process.env.HOME ?? '', '.dsh', 'profiles', PROFILE), { recursive: true, force: true })
  const failed = results.filter((item) => !item.ok)
  if (blocked) {
    console.log('\nBLOCKED: 模型认证不可用')
    exitCode = 2
  } else if (failed.length > 0) {
    console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`)
    console.log(`保留现场：${vault}`)
    exitCode = 1
  } else {
    console.log(`\n结果: ${results.length}/${results.length} 通过`)
    await rm(dir, { recursive: true, force: true })
  }
}

process.exit(exitCode)
