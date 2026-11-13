/** 文档可执行：README 里许诺的命令、CLI 里列出的子命令都必须真实存在。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 跑 CLI 并拿 stdout。 */
function cli(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(ROOT, 'packages/core/src/cli.ts'), ...args], { timeout: 60_000 }, (error, stdout) => {
      if (error !== null && (error as { code?: number }).code !== 2) reject(error)
      else resolve(String(stdout))
    })
  })
}

test('文档：CLI 用法里列出全部已实现的子命令', async () => {
  const usage = await cli([])
  for (const command of ['doctor', 'normalize', 'query', 'context', 'hook', 'checkpoint', 'checkpoints', 'restore']) {
    assert.match(usage, new RegExp(`pko ${command}`), `用法里缺 ${command}`)
  }
})

test('文档：README 与手册引用的 npm 脚本都存在', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  const docs = ['README.md', 'docs/INSTALL.md', 'docs/USAGE.md', 'docs/DEVELOPMENT.md', 'docs/ARCHITECTURE.md', 'docs/CONFORMANCE.md']
  for (const doc of docs) {
    let text = ''
    try {
      text = await readFile(join(ROOT, doc), 'utf8')
    } catch {
      continue // 文档尚未创建时跳过
    }
    for (const match of text.matchAll(/npm run ([a-z0-9:-]+)/g)) {
      const script = match[1]
      assert.ok(script in pkg.scripts, `${doc} 引用了不存在的脚本 npm run ${script}`)
    }
    for (const match of text.matchAll(/node (packages\/[^\s`]+)/g)) {
      const target = match[1]
      const exists = await readFile(join(ROOT, target), 'utf8').then(() => true).catch(() => false)
      assert.ok(exists, `${doc} 引用了不存在的文件 ${target}`)
    }
  }
})


test('文档：站内相对链接都能解析到真实文件', async () => {
  const docs = ['README.md', 'docs/INSTALL.md', 'docs/USAGE.md', 'docs/DEVELOPMENT.md', 'docs/ARCHITECTURE.md', 'docs/CONFORMANCE.md']
  for (const doc of docs) {
    const text = await readFile(join(ROOT, doc), 'utf8')
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]
      if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue
      const clean = target.split('#')[0]
      if (clean === '') continue
      const resolved = join(dirname(join(ROOT, doc)), clean)
      const exists = await stat(resolved).then(() => true).catch(() => false)
      assert.ok(exists, `${doc} 里的链接指向了不存在的文件：${target}`)
    }
  }
})
