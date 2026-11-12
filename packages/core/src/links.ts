/** wikilink 的抽取与目标归一化。 */

/** `[[target]]`、`[[target#heading]]`、`[[target|alias]]` 三种写法统一抽取 target。 */
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

/** 围栏代码块（```/~~~，含语言标注）。 */
const FENCED_CODE = /(^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$)/g

/** 行内代码。 */
const INLINE_CODE = /`[^`\n]*`/g

/**
 * 去掉代码区域。
 *
 * 文档里的示例链接（````[[文件路径]]````）不是真实链接，不剥掉会让 doctor 的断链
 * 规则产生大量误报——实测真实 vault 的 21 条断链里有 12 条属于这一类。
 *
 * @param text 页面正文
 * @returns 去掉围栏代码块与行内代码后的文本
 */
export function stripCode(text: string): string {
  return text.replace(FENCED_CODE, '\n').replace(INLINE_CODE, '')
}

/**
 * 抽取正文中的 wikilink 目标。
 * @param text 页面正文
 * @returns 去重后的目标列表（已剥离代码区域、锚点、别名与 `.md` 后缀）
 */
export function extractLinks(text: string): string[] {
  const targets: string[] = []
  for (const match of stripCode(text).matchAll(WIKILINK)) {
    const target = match[1]?.trim().replace(/\.md$/, '')
    if (target !== undefined && target !== '') targets.push(target)
  }
  return [...new Set(targets)]
}

/**
 * 归一化链接目标：去掉 `./` 前缀与 `.md` 后缀。
 * @param target 原始目标
 * @returns 归一化后的路径或 id
 */
export function normalizeTarget(target: string): string {
  return target.trim().replace(/^\.\//, '').replace(/\.md$/, '')
}
