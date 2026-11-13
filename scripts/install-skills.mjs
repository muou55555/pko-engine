#!/usr/bin/env node
/**
 * 把 packages/skills 下的技能装进一个 vault。
 *
 * 默认只装到 `.dsh/skills`（DSH 的项目级技能根）。
 * `--with-claude` 额外在 `.claude/skills` 建符号链接（Claude Code 用）。
 */
import { cp, mkdir, readdir, rm, symlink, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(ROOT, 'packages', 'skills')

/** 解析参数。 */
function parseArgs(argv) {
  let vault = ''
  let withClaude = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--vault') { vault = argv[index + 1] ?? ''; index += 1; continue }
    if (arg === '--with-claude') { withClaude = true; continue }
    if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/install-skills.mjs --vault <vault 路径> [--with-claude]')
      process.exit(0)
    }
  }
  if (vault === '') {
    console.error('install-skills: 缺少 --vault')
    process.exit(2)
  }
  return { vault: resolve(vault), withClaude }
}

/** 目录是否存在。 */
async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

const { vault, withClaude } = parseArgs(process.argv.slice(2))
if (!await exists(vault)) {
  console.error(`install-skills: vault 不存在：${vault}`)
  process.exit(2)
}

const names = (await readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const dshRoot = join(vault, '.dsh', 'skills')
await mkdir(dshRoot, { recursive: true })
for (const name of names) {
  const target = join(dshRoot, name)
  await rm(target, { recursive: true, force: true })
  await cp(join(SOURCE, name), target, { recursive: true })
}
console.log(`已安装 ${names.length} 个技能 → ${dshRoot}`)
console.log(names.map((name) => `  - ${name}`).join('\n'))

if (withClaude) {
  const claudeRoot = join(vault, '.claude', 'skills')
  await mkdir(claudeRoot, { recursive: true })
  for (const name of names) {
    const link = join(claudeRoot, name)
    await rm(link, { recursive: true, force: true })
    await symlink(join('..', '..', '.dsh', 'skills', name), link, 'dir')
  }
  console.log(`已建符号链接 → ${claudeRoot}`)
}
