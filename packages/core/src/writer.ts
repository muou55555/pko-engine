/**
 * 写入协议：锁 → 版本校验 → 归一化 → 原子写 → 日志 → manifest。
 *
 * 顺序是契约的一部分：先拿锁再读版本，先落文件再记日志，
 * 任何一步失败都不留下"日志说写了、文件其实没写"的状态。
 */
import { appendFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ConflictError } from './errors.ts'
import { sha256 } from './hash.ts'
import { acquireLock } from './lock.ts'
import { mergeManifest, readManifest, writeManifest } from './manifest.ts'
import { extraFields, normalizePage, renderPage, type RawFields } from './normalize.ts'
import { vaultPaths } from './paths.ts'
import { parseFrontmatter } from './schema.ts'
import { atomicWrite, readIfExists } from './store.ts'
import type { Confidence, Tier, WikiPage } from './types.ts'
import { PRODUCED_BY } from './version.ts'
import { categoryOf, stemOf, toPage } from './vault.ts'

export interface WritePageInput {
  readonly vault: string
  readonly relPath: string
  readonly body: string
  /** 额外字段，键名与 frontmatter 一致。 */
  readonly extra?: RawFields
  /** 来源键；与 contentHash 同时提供时更新 manifest。 */
  readonly sourceKey?: string
  readonly contentHash?: string
  readonly expectedHash?: string
  readonly now?: Date
  readonly waitMs?: number
  /** true = 不追加 log.md（批量归一化时由调用方汇总一条）。 */
  readonly silent?: boolean
}

export interface WritePageResult {
  readonly relPath: string
  readonly id: string
  readonly changed: boolean
  readonly skipped: boolean
  readonly filled: readonly string[]
}

/**
 * 日志时间戳：`YYYY-MM-DD HH:mm`。
 * @param date 时间
 * @returns 格式化后的时间戳
 */
export function stamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * 追加一行操作日志；文件不存在时创建并写标题。
 * @param logFile 日志文件路径
 * @param line 一行内容
 */
export async function appendLogLine(logFile: string, line: string): Promise<void> {
  await mkdir(dirname(logFile), { recursive: true })
  const existing = await readIfExists(logFile)
  if (existing === undefined) {
    await atomicWrite(logFile, `# 操作日志（append-only）\n\n${line}\n`)
    return
  }
  const separator = existing.endsWith('\n') ? '' : '\n'
  await appendFile(logFile, `${separator}${line}\n`, 'utf8')
}

/**
 * 记录一次写活动，供 Stop 钩子判断是否需要刷新 hot.md。
 * @param activityFile 活动文件路径
 * @param date 活动时间
 */
export async function recordActivity(activityFile: string, date: Date): Promise<void> {
  await atomicWrite(activityFile, `${JSON.stringify({ ts: date.getTime() })}\n`)
}

/**
 * 判断文件是否存在。
 * @param path 绝对路径
 * @returns 是否存在
 */
export async function existsFile(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 把 extra 字段合并进页面。 */
function applyExtra(page: WikiPage, extra: RawFields | undefined): WikiPage {
  if (extra === undefined) return page
  const str = (key: string): string | undefined => {
    const value = extra[key]
    if (value === undefined) return undefined
    return Array.isArray(value) ? value.join(', ') : value
  }
  const tags = extra.tags
  return {
    ...page,
    title: str('title') ?? page.title,
    type: str('type') ?? page.type,
    status: str('status') ?? page.status,
    confidence: (str('confidence') as Confidence | undefined) ?? page.confidence,
    tier: (str('tier') as Tier | undefined) ?? page.tier,
    tags: tags === undefined ? page.tags : (Array.isArray(tags) ? [...tags] : [tags]),
    source: str('source') ?? page.source,
    summary: str('summary') ?? page.summary,
    created: str('created') ?? page.created,
    updated: str('updated') ?? page.updated,
  }
}

/**
 * 写一个页面。
 * @param input 写入请求
 * @returns 写入结果；内容未变时 `skipped` 为 true
 * @throws ConflictError 版本校验失败
 */
export async function writePage(input: WritePageInput): Promise<WritePageResult> {
  const paths = vaultPaths(input.vault)
  const rel = input.relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const target = join(paths.root, rel)
  const now = input.now ?? new Date()
  const stem = stemOf(rel)

  const lock = await acquireLock(paths.lockFile, { waitMs: input.waitMs })
  try {
    const existing = await readIfExists(target)
    const existingHash = existing === undefined ? undefined : sha256(existing)
    if (input.expectedHash !== undefined && input.expectedHash !== existingHash) {
      throw new ConflictError(rel, input.expectedHash, existingHash)
    }

    const parsed = existing === undefined ? undefined : parseFrontmatter(existing)
    const base: WikiPage = existing === undefined
      ? {
          id: stem,
          title: '',
          type: '',
          tags: [],
          tier: 'supporting',
          path: rel,
          category: categoryOf(rel),
          body: input.body,
          links: [],
          hasFrontmatter: false,
        }
      : { ...toPage(rel, existing), body: input.body }

    const withExtra = applyExtra(base, input.extra)
    const { page, changed } = normalizePage(withExtra, { stem, now })
    const preserved: RawFields = { ...extraFields(parsed?.data), ...extraFields(input.extra) }
    const text = renderPage(page, preserved)

    if (existing !== undefined && sha256(existing) === sha256(text)) {
      return { relPath: rel, id: page.id, changed: false, skipped: true, filled: [] }
    }

    await atomicWrite(target, text)
    if (input.silent !== true) {
      await appendLogLine(paths.logFile, `- [${stamp(now)}] write ${rel} (${page.id})`)
    }
    await recordActivity(paths.activityFile, now)

    if (input.sourceKey !== undefined && input.contentHash !== undefined) {
      const manifest = await readManifest(paths.manifestFile)
      await writeManifest(paths.manifestFile, mergeManifest(manifest, input.sourceKey, {
        hash: input.contentHash,
        pages: [page.id],
        lastIngested: now.toISOString(),
        producedBy: PRODUCED_BY,
      }))
    }

    return { relPath: rel, id: page.id, changed: true, skipped: false, filled: changed }
  } finally {
    await lock.release()
  }
}
