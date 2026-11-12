/**
 * 分层检索：L1 index → L2 标题/标签/摘要 → L3 正文 → L4 wikilink 邻居。
 *
 * 成本护栏：L2 一旦命中就停在 L2（外加摘要层），不再扫正文——
 * 页面上千时正文扫描是主要开销，而标题命中通常已经很准。
 * `deep: true` 可关闭护栏，用于排查召回不足。
 */
import { readIfExists } from './store.ts'
import { tokenizeQuery } from './tokens.ts'
import { extractLinks } from './links.ts'
import type { WikiPage } from './types.ts'
import { isPagePath, scanVault, stemOf } from './vault.ts'
import { vaultPaths } from './paths.ts'

/** 命中来源。 */
export type MatchedBy = 'title' | 'tag' | 'summary' | 'body' | 'graph' | 'index'

export interface Candidate {
  readonly id: string
  readonly path: string
  readonly category: string
  readonly title: string
  readonly confidence: string
  readonly matchedBy: MatchedBy
  readonly score: number
  readonly snippet?: string
}

export interface RetrievalResult {
  readonly query: string
  readonly strategy: string
  readonly totalPages: number
  readonly candidates: readonly Candidate[]
}

export interface RetrieveOptions {
  readonly mode?: 'auto' | 'index-only'
  readonly maxCandidates?: number
  /** true = 关闭 L2 成本护栏，继续扫正文。 */
  readonly deep?: boolean
  /**
   * 页面数超过这个值才启用成本护栏。默认 500。
   * 护栏是规模保护，不是语义规则——小库扫正文只要几十毫秒，没必要牺牲召回。
   */
  readonly guardThreshold?: number
}

/** 护栏默认阈值。 */
const DEFAULT_GUARD_THRESHOLD = 500

/** 各层的基准分。 */
const BASE = { titleExact: 10, title: 6, tag: 4, summary: 2, body: 3, graph: 1, index: 5 } as const

/** tier 权重。 */
const TIER_WEIGHT: Readonly<Record<string, number>> = { core: 1.3, supporting: 1, peripheral: 0.7 }

/** 单次 snippet 上限（字符）。 */
const MAX_SNIPPET = 200

/** 命中词数 / 总词数。 */
function matchRatio(haystack: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0
  let matched = 0
  for (const token of tokens) if (haystack.includes(token)) matched += 1
  return matched / tokens.length
}

/** 首个命中词位置。 */
function firstMatchIndex(haystack: string, tokens: readonly string[]): number {
  let best = -1
  for (const token of tokens) {
    const index = haystack.indexOf(token)
    if (index < 0) continue
    if (best < 0 || index < best) best = index
  }
  return best
}

/** 以命中位置为中心截取片段。 */
function snippetAround(body: string, tokens: readonly string[]): string | undefined {
  const index = firstMatchIndex(body.toLowerCase(), tokens)
  if (index < 0) return undefined
  const half = Math.floor(MAX_SNIPPET / 2)
  const start = Math.max(0, index - half)
  const piece = body.slice(start, start + MAX_SNIPPET).replace(/\s+/g, ' ').trim()
  return piece
}

/** 计算页面的连接度（出链 + 入链）。 */
function degreeMap(pages: readonly WikiPage[]): Map<string, number> {
  const degree = new Map<string, number>()
  const byId = new Map<string, WikiPage>()
  for (const page of pages) byId.set(page.id, page)
  for (const page of pages) degree.set(page.path, (degree.get(page.path) ?? 0) + page.links.length)
  for (const page of pages) {
    for (const target of page.links) {
      const hit = byId.get(target) ?? pages.find((candidate) => stemOf(candidate.path) === target)
      if (hit !== undefined) degree.set(hit.path, (degree.get(hit.path) ?? 0) + 1)
    }
  }
  return degree
}

/** 综合分：基准分 × tier 权重 × 连接度微调。 */
function scoreOf(base: number, page: WikiPage, degree: number): number {
  const weight = TIER_WEIGHT[page.tier] ?? 1
  return base * weight * (1 + 0.05 * Math.log1p(degree))
}

/** 收集候选，同页保留最高分。 */
function push(bucket: Map<string, Candidate>, candidate: Candidate): void {
  const existing = bucket.get(candidate.path)
  if (existing === undefined || candidate.score > existing.score) bucket.set(candidate.path, candidate)
}

/** L1：在 index.md 里按行匹配，取该行出现的 wikilink。 */
async function indexCandidates(
  vault: string,
  tokens: readonly string[],
  pages: readonly WikiPage[],
  degree: Map<string, number>,
): Promise<Candidate[]> {
  const text = await readIfExists(vaultPaths(vault).indexPath)
  if (text === undefined) return []
  const byStem = new Map<string, WikiPage>()
  for (const page of pages) byStem.set(stemOf(page.path), page)
  const hits: Candidate[] = []
  for (const line of text.split('\n')) {
    const lower = line.toLowerCase()
    if (!tokens.some((token) => lower.includes(token))) continue
    for (const target of extractLinks(line)) {
      // 只接受精确路径或目录边界，避免 [[a]] 误配 articles/foo.md
      const page = byStem.get(stemOf(target))
        ?? pages.find((candidate) => candidate.path === `${target}.md` || candidate.path.startsWith(`${target}/`))
      if (page === undefined) continue
      hits.push({
        id: page.id,
        path: page.path,
        category: page.category,
        title: page.title,
        confidence: page.confidence ?? '',
        matchedBy: 'index',
        score: scoreOf(BASE.index, page, degree.get(page.path) ?? 0),
      })
    }
  }
  return hits
}

/**
 * 执行一次分层检索。
 * @param vault vault 根目录
 * @param query 查询串
 * @param options 检索选项
 * @returns 候选与策略说明
 */
export async function retrieve(vault: string, query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
  const mode = options.mode ?? 'auto'
  const maxCandidates = options.maxCandidates ?? 10
  const tokens = tokenizeQuery(query)
  const scanned = await scanVault(vault)
  const pages = scanned.pages.filter((page) => isPagePath(page.path))
  const totalPages = pages.length

  if (tokens.length === 0) {
    return { query, strategy: 'empty-query', totalPages, candidates: [] }
  }

  const degree = degreeMap(pages)
  const bucket = new Map<string, Candidate>()

  const indexHits = await indexCandidates(vault, tokens, pages, degree)
  for (const hit of indexHits) push(bucket, hit)
  if (mode === 'index-only') {
    return { query, strategy: 'index', totalPages, candidates: rank(bucket, maxCandidates) }
  }

  // L2：标题 / 标签 / 摘要
  let frontHit = false
  for (const page of pages) {
    const titleLower = page.title.toLowerCase()
    const degreeNow = degree.get(page.path) ?? 0
    if (titleLower === query.trim().toLowerCase()) {
      push(bucket, toCandidate(page, 'title', scoreOf(BASE.titleExact, page, degreeNow)))
      frontHit = true
      continue
    }
    if (titleLower !== '' && tokens.some((token) => titleLower.includes(token))) {
      push(bucket, toCandidate(page, 'title', scoreOf(BASE.title, page, degreeNow)))
      frontHit = true
    }
    if (page.tags.some((tag) => tokens.some((token) => tag.toLowerCase().includes(token)))) {
      push(bucket, toCandidate(page, 'tag', scoreOf(BASE.tag, page, degreeNow)))
      frontHit = true
    }
    const summary = (page.summary ?? '').toLowerCase()
    if (summary !== '' && tokens.some((token) => summary.includes(token))) {
      push(bucket, toCandidate(page, 'summary', scoreOf(BASE.summary, page, degreeNow)))
    }
  }

  const guardActive = options.deep !== true && pages.length > (options.guardThreshold ?? DEFAULT_GUARD_THRESHOLD)
  if (frontHit && guardActive) {
    return { query, strategy: 'index+title+tag+summary', totalPages, candidates: rank(bucket, maxCandidates) }
  }

  // L3：正文
  const bodyHits: WikiPage[] = []
  for (const page of pages) {
    const ratio = matchRatio(page.body.toLowerCase(), tokens)
    if (ratio <= 0) continue
    bodyHits.push(page)
    push(bucket, {
      ...toCandidate(page, 'body', scoreOf(BASE.body * ratio, page, degree.get(page.path) ?? 0)),
      ...(snippetAround(page.body, tokens) === undefined ? {} : { snippet: snippetAround(page.body, tokens) }),
    })
  }

  // L4：正文命中页的一跳邻居
  const bodyPaths = new Set(bodyHits.map((page) => page.path))
  const byStem = new Map<string, WikiPage>()
  for (const page of pages) byStem.set(stemOf(page.path), page)
  for (const page of bodyHits) {
    for (const target of page.links) {
      const neighbor = byStem.get(stemOf(target))
      if (neighbor === undefined || bodyPaths.has(neighbor.path)) continue
      push(bucket, toCandidate(neighbor, 'graph', scoreOf(BASE.graph, neighbor, degree.get(neighbor.path) ?? 0)))
    }
  }

  return { query, strategy: 'index+title+tag+summary+body+graph', totalPages, candidates: rank(bucket, maxCandidates) }
}

/** 构造候选。 */
function toCandidate(page: WikiPage, matchedBy: MatchedBy, score: number): Candidate {
  return {
    id: page.id,
    path: page.path,
    category: page.category,
    // 标题只用于展示：缺 frontmatter title 时用文件名兜底，避免出现空标题
    title: page.title !== '' ? page.title : stemOf(page.path),
    confidence: page.confidence ?? '',
    matchedBy,
    score: Math.round(score * 100) / 100,
  }
}

/** 排序后截断。 */
function rank(bucket: Map<string, Candidate>, maxCandidates: number): Candidate[] {
  return [...bucket.values()]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, maxCandidates)
}
