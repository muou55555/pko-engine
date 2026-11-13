/** 面向模型的工具集：每个工具只是 core 能力的一层薄封装。 */
import { resolveVault } from './vault.ts'
import type { PkoConfig } from './config.ts'
import { retrieve } from '../../core/src/retrieve.ts'
import { runDoctor } from '../../core/src/doctor.ts'
import { scanVault, stemOf, isPagePath } from '../../core/src/vault.ts'
import { bodyContext, sessionContext, taskContext } from '../../core/src/context.ts'
import { writePage } from '../../core/src/writer.ts'
import { extraFields, normalizePage, renderPage } from '../../core/src/normalize.ts'
import { parseFrontmatter } from '../../core/src/schema.ts'
import { readIfExists, atomicWrite } from '../../core/src/store.ts'
import { sha256 } from '../../core/src/hash.ts'
import { vaultPaths } from '../../core/src/paths.ts'
import { join } from 'node:path'

/** 纯文本内容块。 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** 一个工具的定义（宿主无关形状）。 */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly outputSchema: Record<string, unknown>
  render(args: Record<string, unknown>, value: unknown): TextBlock[]
  run(vault: string, args: Record<string, unknown>): Promise<unknown>
}

/** 宿主上下文里本插件用到的最小面。 */
export interface ToolHost {
  tools: {
    register(definition: {
      name: string
      description: string
      parameters: Record<string, unknown>
      output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): TextBlock[] }
      execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
    }): () => void
  }
  logger?: { info?(message: string): void; warn?(message: string): void }
}

/** 从执行上下文防御性读取会话目录。 */
export function cwdOf(exec: unknown): string {
  const record = exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | null
  const cwd = record?.agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : process.cwd()
}

/** 文件名安全的 slug：保留中文与字母数字。 */
function slug(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? `note-${Date.now()}` : cleaned.slice(0, 60)
}

/** 字符串参数。 */
function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/** 数字参数。 */
function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const text = (value: string): TextBlock[] => [{ type: 'text', text: value }]

/** 全部工具定义。 */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'pko_query',
    description: '在 PKO vault 中检索知识：index → 标题/标签/摘要 → 正文 → 双链邻居。只读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索词，通常直接用用户的问法' },
        mode: { type: 'string', enum: ['auto', 'index-only'], description: 'index-only 只查索引页' },
        maxCandidates: { type: 'number', description: '候选上限，默认 10' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        strategy: { type: 'string' },
        totalPages: { type: 'number' },
        candidates: { type: 'array' },
      },
    },
    render: (_args, value) => {
      const result = value as { candidates: Array<{ path: string; title: string; score: number; matchedBy: string }>; strategy: string }
      if (result.candidates.length === 0) return text('pko: 没有命中。可以把相关知识写进 vault 后再查。')
      return text([`检索到 ${result.candidates.length} 条（${result.strategy}）：`,
        ...result.candidates.map((candidate) => `- ${candidate.path} — ${candidate.title}（${candidate.matchedBy}，${candidate.score}）`)].join('\n'))
    },
    run: async (vault, args) => {
      const mode = str(args, 'mode') === 'index-only' ? 'index-only' : 'auto'
      return retrieve(vault, str(args, 'query') ?? '', { mode, maxCandidates: num(args, 'maxCandidates') ?? 10 })
    },
  },
  {
    name: 'pko_read',
    description: '读取 vault 中某一页的完整正文与元信息。按 id 或文件名匹配。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', description: '页面 id 或文件名（不含 .md）' } },
      required: ['id'],
    },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } },
    render: (_args, value) => {
      const page = value as { path: string; title: string; body: string }
      return text(`${page.path} — ${page.title}\n\n${page.body}`)
    },
    run: async (vault, args) => {
      const id = str(args, 'id') ?? ''
      const { pages } = await scanVault(vault)
      const page = pages.find((candidate) => candidate.id === id || stemOf(candidate.path) === id)
      if (page === undefined) throw new Error(`pko: 找不到页面 ${id}`)
      return { path: page.path, title: page.title, body: page.body }
    },
  },
  {
    name: 'pko_context',
    description: '取一段可注入的知识上下文：会话档（hot.md）/ 任务档（按原话召回）/ 整页档。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: { type: 'string', description: '任务原话，给任务档用' },
        page: { type: 'string', description: '页面 id，给整页档用' },
      },
    },
    outputSchema: { type: 'object', properties: { tier: { type: 'string' }, text: { type: 'string' }, tokens: { type: 'number' } } },
    render: (_args, value) => {
      const context = value as { tier: string; text: string; tokens: number }
      return text(`[${context.tier}] ${context.tokens} tokens\n\n${context.text}`)
    },
    run: async (vault, args) => {
      const page = str(args, 'page')
      const task = str(args, 'task')
      const context = page !== undefined
        ? await bodyContext(vault, page)
        : task !== undefined
          ? await taskContext(vault, task)
          : await sessionContext(vault)
      if (context === undefined) throw new Error('pko: 没有可注入的上下文')
      return context
    },
  },
  {
    name: 'pko_capture',
    description: '把一条结论快速写成知识页，默认落到 00-Inbox/。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        path: { type: 'string', description: 'vault 内相对路径；缺省用 00-Inbox/<标题>.md' },
      },
      required: ['title', 'body'],
    },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, id: { type: 'string' }, created: { type: 'boolean' } } },
    render: (_args, value) => {
      const result = value as { path: string; created: boolean }
      return text(`pko: ${result.created ? '已写入' : '内容未变，已跳过'} ${result.path}`)
    },
    run: async (vault, args) => {
      const title = str(args, 'title') ?? '未命名'
      const relPath = str(args, 'path') ?? `00-Inbox/${slug(title)}.md`
      const result = await writePage({ vault, relPath, body: str(args, 'body') ?? '', extra: { title } })
      return { path: result.relPath, id: result.id, created: result.changed }
    },
  },
  {
    name: 'pko_ingest',
    description: '批量写入知识页；同一来源内容未变时自动跳过（contentHash 增量）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: '来源标识：URL / 文件路径 / 会话 id' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { path: { type: 'string' }, body: { type: 'string' }, title: { type: 'string' } },
            required: ['path', 'body'],
          },
        },
      },
      required: ['pages'],
    },
    outputSchema: { type: 'object', properties: { written: { type: 'number' }, skipped: { type: 'number' }, paths: { type: 'array' } } },
    render: (_args, value) => {
      const result = value as { written: number; skipped: number }
      return text(`pko: 写入 ${result.written} 页，跳过 ${result.skipped} 页`)
    },
    run: async (vault, args) => {
      const source = str(args, 'source')
      const pages = Array.isArray(args.pages) ? args.pages as Array<Record<string, unknown>> : []
      let written = 0
      let skipped = 0
      const paths: string[] = []
      for (const page of pages) {
        const relPath = typeof page.path === 'string' ? page.path : ''
        const body = typeof page.body === 'string' ? page.body : ''
        if (relPath === '') continue
        const title = typeof page.title === 'string' ? page.title : undefined
        const result = await writePage({
          vault,
          relPath,
          body,
          ...(title === undefined ? {} : { extra: { title } }),
          sourceKey: source ?? relPath,
          contentHash: sha256(body),
        })
        paths.push(result.relPath)
        if (result.skipped) skipped += 1
        else written += 1
      }
      return { written, skipped, paths }
    },
  },
  {
    name: 'pko_lint',
    description: '检查 vault 健康度：缺 frontmatter、断链、孤儿页、重复 id。只读。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { type: 'object', properties: { pages: { type: 'number' }, counts: { type: 'object' } } },
    render: (_args, value) => {
      const report = value as { pages: number; counts: { error: number; warn: number; info: number } }
      return text(`pko: ${report.pages} 页，${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info`)
    },
    run: async (vault) => {
      const report = await runDoctor(vault)
      return { pages: report.pages, counts: report.counts }
    },
  },
  {
    name: 'pko_normalize',
    description: '补齐缺失的 frontmatter 字段（title/type/created/updated/summary）。默认只报告，apply=true 才写盘。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { apply: { type: 'boolean', description: 'true = 实际写盘' } },
    },
    outputSchema: { type: 'object', properties: { pending: { type: 'number' }, fixed: { type: 'number' }, paths: { type: 'array' } } },
    render: (_args, value) => {
      const result = value as { pending: number; fixed: number }
      return text(`pko: ${result.pending} 页待修复，实际修复 ${result.fixed} 页`)
    },
    run: async (vault, args) => {
      const apply = args.apply === true
      const { pages } = await scanVault(vault)
      const pending = pages
        .filter((page) => isPagePath(page.path))
        .map((page) => ({ original: page, ...normalizePage(page, { stem: stemOf(page.path) }) }))
        .filter((item) => item.changed.length > 0)
      if (!apply) return { pending: pending.length, fixed: 0, paths: pending.map((item) => item.page.path) }
      for (const item of pending) {
        const abs = join(vaultPaths(vault).root, item.original.path)
        const raw = await readIfExists(abs)
        const preserved = extraFields(parseFrontmatter(raw ?? '')?.data)
        await atomicWrite(abs, renderPage(item.page, preserved))
      }
      return { pending: pending.length, fixed: pending.length, paths: pending.map((item) => item.original.path) }
    },
  },
]

/**
 * 注册全部工具。
 * @param ctx 宿主上下文
 * @param config 插件配置
 * @returns 释放函数
 */
export function mountTools(ctx: ToolHost, config: PkoConfig): () => void {
  const offs: Array<() => void> = []
  for (const spec of TOOL_SPECS) {
    offs.push(ctx.tools.register({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: { schema: spec.outputSchema, render: (args, value) => spec.render(args as Record<string, unknown>, value) },
      execute: async (args, exec) => {
        const cwd = cwdOf(exec)
        const vault = resolveVault(config.vault, cwd)
        if (vault === undefined) throw new Error('pko: 当前会话目录不在任何 PKO vault 内')
        return spec.run(vault, args)
      },
    }))
  }
  return () => { for (const off of offs) off() }
}
