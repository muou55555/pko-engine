#!/usr/bin/env node
/** 依赖为零的代码卫生检查：不引入 lint 工具链，也能在 CI 里守住底线。 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'packages', 'core', 'src')

const RULES = [
  { name: 'any 类型', pattern: /:\s*any\b|\bas any\b/, hint: '用具体类型或 unknown + 收窄' },
  { name: 'ts-ignore / ts-nocheck', pattern: /@ts-(ignore|nocheck)/, hint: '修类型，不要压制' },
  { name: 'console 输出', pattern: /\bconsole\.(log|debug)\(/, hint: '库代码应返回结果，不直接打印' },
  { name: 'tab 缩进', pattern: /^\t/m, hint: '统一两个空格' },
  { name: '行尾空白', pattern: /[ \t]+$/m, hint: '去掉行尾空白' },
  { name: '连续空行', pattern: /\n{3,}/, hint: '最多一个空行' },
]

/** 递归收集 .ts 文件。 */
async function collect(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collect(abs))
    else if (entry.name.endsWith('.ts')) out.push(abs)
  }
  return out
}

const problems = []
for (const file of await collect(SRC)) {
  const text = await readFile(file, 'utf8')
  const rel = relative(ROOT, file)
  for (const rule of RULES) {
    if (rule.pattern.test(text)) problems.push(`${rel}: ${rule.name} —— ${rule.hint}`)
  }
  if (!text.endsWith('\n') || text.endsWith('\n\n')) problems.push(`${rel}: 文件必须以单个换行结尾`)
}

if (problems.length > 0) {
  console.error(`hygiene: ${problems.length} 处问题`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('hygiene: OK')
