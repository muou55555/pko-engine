/**
 * PKO 核心数据契约。
 *
 * 词表刻意保持「读取宽容」：未识别的取值由 doctor 告警，而不是让整页解析失败——
 * 真实 vault 以手写为主，一个拼写错误不该让页面从检索面里消失。
 */

/** 页面类型（沿用 PKO 既有词表）。 */
export const PAGE_TYPES = [
  'daily', 'weekly', 'monthly', 'project', 'card', 'wiki',
  'meeting', 'article', 'clip', 'moc', 'note',
  // 真实库里常见的功能型页面：操作指南、参考资料、元数据页
  'how-to', 'reference', 'meta',
] as const

export type PageType = (typeof PAGE_TYPES)[number]

/** 成熟度与生命周期两套词表并存（README 与 CLAUDE.md 各定义一套）。 */
export const STATUSES = [
  'seed', 'developing', 'mature', 'evergreen',
  'active', 'draft', 'done', 'archived',
] as const

export type PageStatus = (typeof STATUSES)[number]

/** 来源可信度：extracted 源材料明确提取 / inferred 模型推断 / ambiguous 存疑。 */
export const CONFIDENCES = ['extracted', 'inferred', 'ambiguous'] as const

export type Confidence = (typeof CONFIDENCES)[number]

/** 重要性分层，检索打分的权重来源。 */
export const TIERS = ['core', 'supporting', 'peripheral'] as const

export type Tier = (typeof TIERS)[number]

/** 一个已解析的知识页。 */
export interface WikiPage {
  /** 稳定 id：frontmatter 的 id，缺省回退文件名。 */
  readonly id: string
  readonly title: string
  readonly type: string
  readonly status?: string
  readonly confidence?: Confidence
  readonly tier: Tier
  readonly tags: readonly string[]
  readonly source?: string
  /** 一句话摘要：L2b 检索层依赖它。 */
  readonly summary?: string
  readonly created?: string
  readonly updated?: string
  /** 相对 vault 根的正斜杠路径。 */
  readonly path: string
  /** 由目录派生，不由 frontmatter 声明。 */
  readonly category: string
  /** 去掉 frontmatter 后的正文。 */
  readonly body: string
  /** 正文中的 wikilink 目标（已剥离锚点与别名）。 */
  readonly links: readonly string[]
  /** 是否存在可解析的 YAML frontmatter。 */
  readonly hasFrontmatter: boolean
}

export type Severity = 'error' | 'warn' | 'info'

/** 一条审计结论。 */
export interface Finding {
  readonly severity: Severity
  readonly code: string
  readonly path: string
  readonly message: string
  /** 可执行的修复建议。 */
  readonly fix?: string
}

/** doctor 的完整报告。 */
export interface DoctorReport {
  readonly vault: string
  readonly pages: number
  readonly findings: readonly Finding[]
  readonly counts: Readonly<Record<Severity, number>>
}
