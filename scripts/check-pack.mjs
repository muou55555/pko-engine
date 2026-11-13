#!/usr/bin/env node
/** 校验 @pko/dsh 的打包内容：该有的都在，不该有的都没进来。 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PKG = join(ROOT, 'packages', 'dsh')

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8' })
const report = JSON.parse(raw)[0]
const files = report.files.map((file) => file.path)

const problems = []
for (const required of ['README.md', 'cordis.patch.yml', 'lib/dsh/src/index.js', 'lib/dsh/skills/pko-query/SKILL.md', 'lib/core/src/index.js']) {
  if (!files.includes(required)) problems.push(`缺少必需文件：${required}`)
}
const forbidden = files.filter((path) => /^(tests|fixtures|src|node_modules)\//.test(path))
if (forbidden.length > 0) problems.push(`打包了不该有的文件：${forbidden.join(', ')}`)
if (report.size > 5 * 1024 * 1024) problems.push(`包体积过大：${report.size} 字节`)

if (problems.length > 0) {
  console.error(`check-pack: ${problems.length} 个问题`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`check-pack: OK（${files.length} 个文件，${report.size} 字节）`)
