#!/usr/bin/env node
/** 把 packages/skills 复制进 @pko/dsh 的构建产物，使插件自带技能。 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(ROOT, 'packages', 'skills')
const TARGET = join(ROOT, 'packages', 'dsh', 'lib', 'dsh', 'skills')

const names = (await readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

await rm(TARGET, { recursive: true, force: true })
await mkdir(TARGET, { recursive: true })
for (const name of names) await cp(join(SOURCE, name), join(TARGET, name), { recursive: true })
console.log(`bundle-skills: 复制 ${names.length} 个技能 → ${TARGET}`)
