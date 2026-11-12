/** 查询分词与 token 估算。 */

/** CJK 字符（汉字 / 假名 / 谚文）。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** 判断整段是否为纯 CJK。 */
function isCjkRun(value: string): boolean {
  return [...value].every((ch) => CJK.test(ch))
}

/**
 * 把查询串切成检索词。
 *
 * 中文没有空格，纯 CJK 段用 2 字滑窗切 bigram；长度门槛是 **2**，不是 3——
 * 切到 3 会把「时区」「预算」这类两字词整个丢掉，导致库里有页也判成无关。
 *
 * @param query 原始查询
 * @returns 去重后的检索词
 */
export function tokenizeQuery(query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return []
  const parts = normalized
    .split(/[\s,，、;；:：|/\\·。！？!?()（）[\]{}"'“”‘’]+/)
    .filter((part) => part.length > 0)
  const tokens: string[] = []
  for (const part of parts) {
    if (!isCjkRun(part)) {
      tokens.push(part)
      continue
    }
    const chars = [...part]
    if (chars.length === 1) {
      tokens.push(part)
      continue
    }
    for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1])
  }
  // 纯标点查询不应退化成「拿整串去匹配」，直接判为无检索词
  return [...new Set(tokens)]
}

/**
 * 粗略估算 token 数：CJK 一字 ≈ 1 token，其余按 4 字符 ≈ 1 token。
 * @param text 文本
 * @returns 估算值
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 按 token 预算裁剪文本。
 * @param text 原文
 * @param maxTokens 预算
 * @returns 裁剪后的文本与是否被截断
 */
export function clipToTokens(text: string, maxTokens: number): { text: string; clipped: boolean } {
  if (estimateTokens(text) <= maxTokens) return { text, clipped: false }
  // 截断标记本身要占预算，否则结果会稳定超出上限
  const suffix = '\n…（已截断）'
  const limit = Math.max(1, maxTokens - estimateTokens(suffix))
  let candidate = text.slice(0, Math.max(1, Math.floor(limit * 1.6)))
  while (candidate.length > 1 && estimateTokens(candidate) > limit) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.9))
  }
  return { text: `${candidate.trimEnd()}${suffix}`, clipped: true }
}
