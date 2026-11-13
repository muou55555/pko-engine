/**
 * 00-Inbox 的完成标记。
 *
 * 摄取完成的判据是 frontmatter 的 `status: done`。这里只改这一个字段：
 * 其余正文与其它字段必须原样保留，因为 Inbox 里的原件是原始材料。
 */

/** frontmatter 块的正则（与 schema 的解析保持一致）。 */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m

/**
 * 判断一个 vault 内相对路径是否位于 00-Inbox。
 * @param relPath 相对路径（以 `/` 分隔）
 * @returns 是否在 Inbox 中
 */
export function isInboxPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  return normalized === '00-Inbox' || normalized.startsWith('00-Inbox/')
}

/**
 * 把文本的 frontmatter 状态改成 done。
 *
 * 规则：
 * - 已有 frontmatter：只替换/补一行 `status: done`，其余字节不动
 * - 没有 frontmatter：在文件顶部插入最小块，正文不动
 *
 * @param text 文件原文
 * @returns 改写后的文本；已经是 done 时原样返回
 */
export function markStatusDone(text: string): string {
  const match = FRONTMATTER.exec(text)
  if (match === null) {
    return `---\nstatus: done\n---\n${text}`
  }

  const start = match.index
  const block = match[1] ?? ''
  const end = start + match[0].length
  const body = text.slice(end)

  const lines = block.split('\n')
  const statusIndex = lines.findIndex((line) => /^status[ \t]*:/.test(line))
  if (statusIndex >= 0) {
    if (/^status[ \t]*:[ \t]*done[ \t]*$/.test(lines[statusIndex] ?? '')) return text
    lines[statusIndex] = 'status: done'
  } else {
    // 去掉末尾的空行再补，避免 frontmatter 里出现多余空行
    while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
    lines.push('status: done')
  }

  return `${text.slice(0, start)}---\n${lines.join('\n')}\n---\n${body}`
}
