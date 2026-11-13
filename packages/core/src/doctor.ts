/** vault 结构审计：frontmatter、断链、孤儿页、重复 id。 */
import type { DoctorReport, Finding, Severity, WikiPage } from './types.ts'
import { PAGE_TYPES, STATUSES } from './types.ts'
import { normalizeTarget } from './links.ts'
import { META_PATHS, scanVault, stemOf } from './vault.ts'

/** 需要 summary 的知识类分类（L2b 检索层依赖它）。 */
const KNOWLEDGE_CATEGORIES: ReadonlySet<string> = new Set([
  'concepts', 'howto', 'references', 'clips', 'synthesis', 'cards',
])

/** 参与孤儿页判定的分类。 */
const ORPHAN_CATEGORIES: ReadonlySet<string> = new Set([
  'projects', 'areas', 'concepts', 'howto', 'references', 'clips', 'synthesis', 'cards',
])

/** 链接解析结果：命中的页面，以及目标是否至少存在（附件文件也算）。 */
interface Resolution {
  readonly pages: readonly WikiPage[]
  readonly exists: boolean
}

/**
 * 收集 Dataview 查询覆盖的目录前缀。
 *
 * 本库的 MOC 用 `FROM "20-Projects/work"` 这类查询自动列出子目录内容，
 * 页面**不需要**被手工 wikilink 才算是"已索引"。只把非空目录当作覆盖，
 * `FROM ""`（整库查询）不算——否则孤儿页判定会整体失效。
 *
 * @param pages 全部页面
 * @returns 以 `/` 结尾的目录前缀
 */
function dataviewCoverage(pages: readonly WikiPage[]): string[] {
  const prefixes = new Set<string>()
  for (const page of pages) {
    for (const match of page.body.matchAll(/FROM\s+"([^"]+)"/gi)) {
      const dir = (match[1] ?? '').trim().replace(/\/+$/, '')
      if (dir === '') continue
      prefixes.add(`${dir}/`)
    }
  }
  return [...prefixes]
}

/**
 * 审计一个 vault。
 * @param root vault 根目录的绝对路径
 * @returns 结构化报告；不修改任何文件
 */
export async function runDoctor(root: string): Promise<DoctorReport> {
  const { pages, files } = await scanVault(root)
  const findings: Finding[] = []
  const push = (severity: Severity, code: string, path: string, message: string, fix?: string): void => {
    findings.push({ severity, code, path, message, ...(fix === undefined ? {} : { fix }) })
  }

  const byId = new Map<string, WikiPage[]>()
  for (const page of pages) {
    const list = byId.get(page.id) ?? []
    list.push(page)
    byId.set(page.id, list)
  }

  for (const [id, list] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue
    const where = list.map((page) => page.path).join('、')
    for (const page of list) {
      push('error', 'E_DUPLICATE_ID', page.path, `id "${id}" 被 ${list.length} 个文件共用：${where}`, '为每个文件提供唯一 id')
    }
  }

  for (const page of pages) {
    if (!page.hasFrontmatter) {
      push('error', 'E_NO_FRONTMATTER', page.path, '缺少 YAML frontmatter', '补齐 --- 围栏块与 id/title/type')
      continue
    }
    if (page.title === '') push('error', 'E_MISSING_TITLE', page.path, '缺少 title', '补 title: …')
    if (page.type === '') {
      push('error', 'E_MISSING_TYPE', page.path, '缺少 type', `补 type，取值之一：${PAGE_TYPES.join(' / ')}`)
    } else if (!(PAGE_TYPES as readonly string[]).includes(page.type)) {
      push('warn', 'W_UNKNOWN_TYPE', page.path, `未知 type "${page.type}"`, `改用 ${PAGE_TYPES.join(' / ')}`)
    }
    if (page.status !== undefined && !(STATUSES as readonly string[]).includes(page.status)) {
      push('warn', 'W_UNKNOWN_STATUS', page.path, `未知 status "${page.status}"`, `改用 ${STATUSES.join(' / ')}`)
    }
    if (page.tags.length === 0) push('warn', 'W_MISSING_TAGS', page.path, '缺少 tags', '补 tags: [领域]')
    if (KNOWLEDGE_CATEGORIES.has(page.category) && page.summary === undefined) {
      push('warn', 'W_MISSING_SUMMARY', page.path, '缺少 summary（L2b 检索层依赖它）', '用与正文不同的措辞写一句摘要')
    }
    const stem = stemOf(page.path)
    if (page.id !== stem) {
      push('warn', 'W_ID_MISMATCH', page.path, `frontmatter id "${page.id}" 与文件名 "${stem}" 不一致`, '统一二者，或确认这是有意为之')
    }
  }

  const byPath = new Map<string, WikiPage>()
  for (const page of pages) byPath.set(page.path.replace(/\.md$/, ''), page)
  const fileSet = new Set(files)
  // 链接可以省略扩展名：`[[20-Projects/_board]]` 指向 `_board.base`。
  // 只按完整文件名匹配会把 canvas/base/pdf 链接误判为断链（实测真实 vault 有 3 条）。
  const fileByStem = new Map<string, string>()
  for (const file of files) {
    const withoutExtension = file.replace(/\.[^./]+$/, '')
    if (!fileByStem.has(withoutExtension)) fileByStem.set(withoutExtension, file)
  }

  const resolve = (raw: string): Resolution => {
    const target = normalizeTarget(raw)
    if (target === '') return { pages: [], exists: false }
    const direct = byPath.get(target)
    if (direct !== undefined) return { pages: [direct], exists: true }
    const matched = byId.get(stemOf(target)) ?? []
    if (matched.length > 0) return { pages: matched, exists: true }
    // 指向附件（.base/.pdf/.canvas/…）的链接只要文件在就算有效，但不计入页面入链
    if (fileSet.has(target) || fileSet.has(`${target}.md`)) return { pages: [], exists: true }
    if (fileByStem.has(target)) return { pages: [], exists: true }
    return { pages: [], exists: false }
  }

  const inlinks = new Map<string, Set<string>>()
  for (const page of pages) inlinks.set(page.path, new Set())

  for (const page of pages) {
    for (const raw of page.links) {
      const resolution = resolve(raw)
      if (!resolution.exists) {
        push('warn', 'W_BROKEN_LINK', page.path, `[[${raw}]] 指向不存在的页面`, '创建该页，或把链接改成纯文本')
        continue
      }
      if (resolution.pages.length > 1) {
        const where = resolution.pages.map((hit) => hit.path).join('、')
        push('warn', 'W_AMBIGUOUS_LINK', page.path, `[[${raw}]] 命中 ${resolution.pages.length} 个页面：${where}`, '改用完整路径链接')
      }
      for (const hit of resolution.pages) inlinks.get(hit.path)?.add(page.path)
    }
  }

  const coverage = dataviewCoverage(pages)
  for (const page of pages) {
    if (!ORPHAN_CATEGORIES.has(page.category)) continue
    if (page.type === 'moc' || page.type === 'wiki') continue
    // 索引 / 日志 / 上下文缓存是基础设施，不要求被别的页面链接
    if (META_PATHS.has(page.path)) continue
    if ((inlinks.get(page.path)?.size ?? 0) > 0) continue
    // 被 MOC 的 Dataview 查询覆盖即视为已索引
    if (coverage.some((prefix) => page.path.startsWith(prefix))) continue
    push('info', 'I_ORPHAN', page.path, '没有任何页面链接到它', '在对应 MOC 或 index.md 中加一条入口')
  }

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return { vault: root, pages: pages.length, findings, counts }
}
