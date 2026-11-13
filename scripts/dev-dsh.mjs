#!/usr/bin/env node
/**
 * @pko/dsh 的开发模式：源码改动 → 自动重编译 → 自动重投技能。
 *
 * 用法：npm run dev:dsh
 * 说明：DSH 不会热加载插件代码，重编译后仍需重启 DSH 才生效。
 */
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PKG = join(ROOT, 'packages', 'dsh')
const SKILLS = join(ROOT, 'packages', 'skills')

let timer
/** 防抖后重新打包技能。 */
function rebundleSkills() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'bundle-skills.mjs')], { stdio: 'inherit' })
    child.on('exit', (code) => {
      console.log(code === 0 ? '✓ 技能已同步到 lib/dsh/skills' : '✗ 技能同步失败')
    })
  }, 120)
}

console.log('▸ 监听 packages/dsh/src 与 packages/skills …')
console.log('  改完源码后重启 DSH 生效（DSH 不热加载插件代码）\n')

const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], {
  cwd: PKG,
  stdio: 'inherit',
})

const watcher = watch(SKILLS, { recursive: true }, (_event, filename) => {
  if (typeof filename === 'string' && filename.endsWith('SKILL.md')) rebundleSkills()
})

/** 统一退出。 */
function shutdown() {
  watcher.close()
  tsc.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
tsc.on('exit', (code) => shutdown(code ?? 0))
