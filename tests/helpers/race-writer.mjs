#!/usr/bin/env node
/** 子进程：按给定期望哈希写一页，结果以 JSON 打到 stdout。 */
const [, , vault, relPath, tag, expectedHash, delayMs] = process.argv
const { writePage } = await import('../../packages/core/src/writer.ts')
await new Promise((resolve) => setTimeout(resolve, Number(delayMs ?? '0')))
try {
  const result = await writePage({ vault, relPath, body: `# 竞态\n\n来自 ${tag}`, expectedHash })
  console.log(JSON.stringify({ ok: true, tag, changed: result.changed }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, tag, name: error?.name, message: String(error?.message ?? error) }))
}
