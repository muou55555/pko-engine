#!/usr/bin/env node
/** 构建并打包 @pko/dsh，产物放到 <repo>/dist/。 */
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PKG_DIR = join(ROOT, 'packages', 'dsh')
const DIST = join(ROOT, 'dist')

console.log('1/3 构建产物')
execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: PKG_DIR, stdio: 'inherit' })
execFileSync(process.execPath, [join(ROOT, 'scripts', 'bundle-skills.mjs')], { stdio: 'inherit' })

console.log('2/3 清理旧包')
await mkdir(DIST, { recursive: true })
for (const name of await readdir(DIST)) {
  if (name.endsWith('.tgz')) await rm(join(DIST, name), { force: true })
}

console.log('3/3 打包')
execFileSync('npm', ['pack', '--pack-destination', DIST], { cwd: PKG_DIR, stdio: 'inherit' })
const tarballs = (await readdir(DIST)).filter((name) => name.endsWith('.tgz'))
console.log(`\n完成：${tarballs.map((name) => join(DIST, name)).join('\n      ')}`)
