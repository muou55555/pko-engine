#!/usr/bin/env node
/**
 * 安装方式验证：tgz 与 git 两种非 registry 路径。
 *
 * 每种方式都做完整闭环：装进一次性 profile → 真实会话调用工具 → 检查技能投放。
 *
 * 用法：
 *   node tests/e2e/install-methods.mjs                # 两种都测
 *   node tests/e2e/install-methods.mjs --mode tgz
 *   node tests/e2e/install-methods.mjs --mode git --repo https://github.com/you/pko-engine.git
 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TASK_TIMEOUT_MS = 240_000
const TASK = '用 pko_lint 检查知识库健康度，只回一句结果'

/** 解析参数。 */
function parseArgs(argv) {
  let mode = 'both'
  let repo = ROOT
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mode') { mode = argv[index + 1] ?? 'both'; index += 1; continue }
    if (argv[index] === '--repo') { repo = argv[index + 1] ?? ROOT; index += 1; continue }
  }
  return { mode, repo }
}

const { mode, repo } = parseArgs(process.argv.slice(2))
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === undefined ? '' : ` —— ${detail}`}`)
}

/** 账号路由补丁：headless 需要这三行才能用已登录的账号。 */
async function writeAccountOverlay(dir) {
  const overlay = join(dir, 'account.yml')
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
  return overlay
}

/** 跑一条 dsh 命令。 */
function dsh(args, options = {}) {
  return spawnSync('dsh', args, { encoding: 'utf8', timeout: options.timeout ?? 240_000, cwd: options.cwd })
}

/** 解析 --json 事件流里的工具名。 */
function toolsOf(stdout) {
  const tools = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const event = JSON.parse(trimmed)
      if (event.type === 'tool_call' && typeof event.tool === 'string') tools.push(event.tool)
    } catch {
      // 忽略非 JSON 行
    }
  }
  return tools
}

/** 建一个最小 vault。 */
async function makeVault(dir) {
  const vault = join(dir, 'vault')
  await mkdir(join(vault, '50-Wiki'), { recursive: true })
  await writeFile(join(vault, '50-Wiki/index.md'), '---\nid: index\ntitle: 索引\ntype: wiki\ntier: supporting\ntags: [meta]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# 索引\n')
  return vault
}

/**
 * 验证一种安装方式。
 * @param spec 安装方式描述
 * @returns 是否全部通过；认证不可用时返回 'blocked'
 */
async function verify(spec) {
  const profile = `pko-install-${spec.id}-${process.pid}`
  const dir = await mkdtemp(join(tmpdir(), `pko-install-${spec.id}-`))
  console.log(`\n▸ 方式 ${spec.label}（profile: ${profile}）`)
  try {
    dsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
    const install = dsh(['plugin', '--profile', profile, 'add', spec.spec])
    if (install.status !== 0) {
      record(`${spec.label} 安装成功`, false, (install.stderr ?? '').split('\n').slice(-3).join(' ').slice(0, 200))
      return false
    }
    record(`${spec.label} 安装成功`, true)

    const vault = await makeVault(dir)
    const overlay = await writeAccountOverlay(dir)
    const run = dsh(['--profile', profile, '--patch', overlay, '--json', TASK], { cwd: vault })
    const stderr = run.stderr ?? ''
    if (/MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED/.test(stderr)) {
      console.log('  （认证不可用，跳过会话断言）')
      return 'blocked'
    }

    const tools = toolsOf(run.stdout ?? '')
    record(`${spec.label} 会话调用了 pko_lint`, tools.includes('pko_lint'), tools.join(',') || '(无工具调用)')
    const skills = await stat(join(vault, '.dsh', 'skills')).then(() => readdir(join(vault, '.dsh', 'skills'))).catch(() => [])
    record(`${spec.label} 投放了 8 个技能`, skills.length === 8, `${skills.length} 个`)
    return true
  } catch (error) {
    record(`${spec.label} 验证异常`, false, String(error).slice(0, 160))
    return false
  } finally {
    await rm(join(process.env.HOME ?? '', '.dsh', 'profiles', profile), { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- 执行 ----
const modes = mode === 'both' ? ['tgz', 'git'] : [mode]
let blocked = false

for (const id of modes) {
  if (id === 'tgz') {
    const pack = spawnSync('npm', ['run', 'pack:dsh'], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
    if (pack.status !== 0) {
      record('tgz 打包', false, (pack.stderr ?? '').slice(-200))
      continue
    }
    const dist = join(ROOT, 'dist')
    const tarball = (await readdir(dist)).filter((name) => name.endsWith('.tgz')).sort().at(-1)
    if (tarball === undefined) {
      record('tgz 打包', false, 'dist 里没有 tgz')
      continue
    }
    const outcome = await verify({ id, label: 'tgz', spec: join(dist, tarball) })
    if (outcome === 'blocked') blocked = true
  }
  if (id === 'git') {
    const spec = repo.startsWith('http') || repo.startsWith('git+')
      ? `git+${repo.replace(/^git\+/, '')}#path:packages/dsh`
      : `git+file://${repo}#path:packages/dsh`
    const outcome = await verify({ id, label: 'git', spec })
    if (outcome === 'blocked') blocked = true
  }
}

if (blocked) {
  console.log('\nBLOCKED: 模型认证不可用，仅完成安装步骤')
}
const failed = results.filter((item) => !item.ok)
console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? (blocked ? 2 : 0) : 1)
