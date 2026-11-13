/** 面向模型的工具集：每个工具只是 core 能力的一层薄封装。 */
import { resolveVault } from "./vault.js";
import { retrieve } from "../../core/src/retrieve.js";
import { runDoctor } from "../../core/src/doctor.js";
import { scanVault, stemOf, isPagePath } from "../../core/src/vault.js";
import { bodyContext, sessionContext, taskContext } from "../../core/src/context.js";
import { writePage } from "../../core/src/writer.js";
import { extraFields, normalizePage, renderPage } from "../../core/src/normalize.js";
import { parseFrontmatter } from "../../core/src/schema.js";
import { readIfExists, atomicWrite } from "../../core/src/store.js";
import { sha256 } from "../../core/src/hash.js";
import { vaultPaths } from "../../core/src/paths.js";
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from "../../core/src/checkpoint.js";
import { applyScaffold, hasVaultMarker, planScaffold, vaultStatus } from "../../core/src/scaffold.js";
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 从执行上下文防御性读取会话目录。 */
export function cwdOf(exec) {
    const record = exec;
    const cwd = record?.agent?.session?.header?.cwd;
    return typeof cwd === 'string' ? cwd : process.cwd();
}
/** 把用户给的路径解析成绝对路径，支持 ~ 与相对路径。 */
function resolveTarget(base, raw) {
    const text = (raw ?? '').trim();
    if (text === '')
        return base;
    const expanded = text === '~' ? homedir() : text.startsWith('~/') ? join(homedir(), text.slice(2)) : text;
    return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}
/** 文件名安全的 slug：保留中文与字母数字。 */
function slug(title) {
    const cleaned = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned === '' ? `note-${Date.now()}` : cleaned.slice(0, 60);
}
/** 字符串参数。 */
function str(args, key) {
    const value = args[key];
    return typeof value === 'string' ? value : undefined;
}
/** 数字参数。 */
function num(args, key) {
    const value = args[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
const text = (value) => [{ type: 'text', text: value }];
/** 全部工具定义。 */
export const TOOL_SPECS = [
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
            const result = value;
            if (result.candidates.length === 0)
                return text('pko: 没有命中。可以把相关知识写进 vault 后再查。');
            return text([`检索到 ${result.candidates.length} 条（${result.strategy}）：`,
                ...result.candidates.map((candidate) => `- ${candidate.path} — ${candidate.title}（${candidate.matchedBy}，${candidate.score}）`)].join('\n'));
        },
        run: async (vault, args) => {
            const mode = str(args, 'mode') === 'index-only' ? 'index-only' : 'auto';
            return retrieve(vault, str(args, 'query') ?? '', { mode, maxCandidates: num(args, 'maxCandidates') ?? 10 });
        },
    },
    {
        name: 'pko_read',
        description: '读取 vault 中某一页的完整正文与元信息。接受页面 id、文件名（含或不含 .md）或 vault 内相对路径。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string', description: '页面 id 或文件名（不含 .md）' } },
            required: ['id'],
        },
        outputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } },
        render: (_args, value) => {
            const page = value;
            return text(`${page.path} — ${page.title}\n\n${page.body}`);
        },
        run: async (vault, args) => {
            const raw = (str(args, 'id') ?? '').trim();
            const target = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/, '');
            const { pages } = await scanVault(vault);
            // 三种写法都接受：页面 id、文件名、vault 内相对路径
            const page = pages.find((candidate) => candidate.id === target)
                ?? pages.find((candidate) => stemOf(candidate.path) === target)
                ?? pages.find((candidate) => candidate.path.replace(/\.md$/, '') === target);
            if (page === undefined)
                throw new Error(`pko: 找不到页面 ${raw}`);
            return { path: page.path, title: page.title, body: page.body };
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
            const context = value;
            return text(`[${context.tier}] ${context.tokens} tokens\n\n${context.text}`);
        },
        run: async (vault, args) => {
            const page = str(args, 'page');
            const task = str(args, 'task');
            const context = page !== undefined
                ? await bodyContext(vault, page)
                : task !== undefined
                    ? await taskContext(vault, task)
                    : await sessionContext(vault);
            if (context === undefined)
                throw new Error('pko: 没有可注入的上下文');
            return context;
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
            const result = value;
            return text(`pko: ${result.created ? '已写入' : '内容未变，已跳过'} ${result.path}`);
        },
        run: async (vault, args) => {
            const title = str(args, 'title') ?? '未命名';
            const relPath = str(args, 'path') ?? `00-Inbox/${slug(title)}.md`;
            const result = await writePage({ vault, relPath, body: str(args, 'body') ?? '', extra: { title } });
            return { path: result.relPath, id: result.id, created: result.changed };
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
            const result = value;
            return text(`pko: 写入 ${result.written} 页，跳过 ${result.skipped} 页`);
        },
        run: async (vault, args) => {
            const source = str(args, 'source');
            const pages = Array.isArray(args.pages) ? args.pages : [];
            let written = 0;
            let skipped = 0;
            const paths = [];
            for (const page of pages) {
                const relPath = typeof page.path === 'string' ? page.path : '';
                const body = typeof page.body === 'string' ? page.body : '';
                if (relPath === '')
                    continue;
                const title = typeof page.title === 'string' ? page.title : undefined;
                const result = await writePage({
                    vault,
                    relPath,
                    body,
                    ...(title === undefined ? {} : { extra: { title } }),
                    sourceKey: source ?? relPath,
                    contentHash: sha256(body),
                });
                paths.push(result.relPath);
                if (result.skipped)
                    skipped += 1;
                else
                    written += 1;
            }
            return { written, skipped, paths };
        },
    },
    {
        name: 'pko_lint',
        description: '检查 vault 健康度：缺 frontmatter、断链、孤儿页、重复 id。只读。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: { type: 'object', properties: { pages: { type: 'number' }, counts: { type: 'object' } } },
        render: (_args, value) => {
            const report = value;
            return text(`pko: ${report.pages} 页，${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info`);
        },
        run: async (vault) => {
            const report = await runDoctor(vault);
            return { pages: report.pages, counts: report.counts };
        },
    },
    {
        name: 'pko_checkpoint',
        description: '还原点：create 创建、list 列出、restore 恢复。用 git ref 实现，创建时不改动工作区。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                action: { type: 'string', enum: ['create', 'list', 'restore'] },
                id: { type: 'string', description: 'action=restore 时的还原点 id' },
            },
            required: ['action'],
        },
        outputSchema: { type: 'object', properties: { action: { type: 'string' }, checkpoints: { type: 'array' } } },
        render: (_args, value) => {
            const result = value;
            if (result.action === 'create')
                return text(`pko: 已创建还原点 ${result.id ?? ''}`);
            if (result.action === 'restore')
                return text(`pko: 已恢复到还原点 ${result.id ?? ''}`);
            const list = result.checkpoints ?? [];
            return text(list.length === 0 ? 'pko: 还没有还原点' : `还原点（${list.length}）：\n${list.map((item) => `- ${item.id} ${item.sha.slice(0, 8)}`).join('\n')}`);
        },
        run: async (vault, args) => {
            const action = str(args, 'action') ?? 'list';
            if (action === 'create') {
                const checkpoint = await createCheckpoint(vault);
                return { action, id: checkpoint.id };
            }
            if (action === 'restore') {
                const id = str(args, 'id') ?? '';
                if (id === '')
                    throw new Error('pko: restore 需要 id');
                await restoreCheckpoint(vault, id);
                return { action, id };
            }
            return { action: 'list', checkpoints: await listCheckpoints(vault) };
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
            const result = value;
            return text(`pko: ${result.pending} 页待修复，实际修复 ${result.fixed} 页`);
        },
        run: async (vault, args) => {
            const apply = args.apply === true;
            const { pages } = await scanVault(vault);
            const pending = pages
                .filter((page) => isPagePath(page.path))
                .map((page) => ({ original: page, ...normalizePage(page, { stem: stemOf(page.path) }) }))
                .filter((item) => item.changed.length > 0);
            if (!apply)
                return { pending: pending.length, fixed: 0, paths: pending.map((item) => item.page.path) };
            for (const item of pending) {
                const abs = join(vaultPaths(vault).root, item.original.path);
                const raw = await readIfExists(abs);
                const preserved = extraFields(parseFrontmatter(raw ?? '')?.data);
                await atomicWrite(abs, renderPage(item.page, preserved));
            }
            return { pending: pending.length, fixed: pending.length, paths: pending.map((item) => item.original.path) };
        },
    },
    {
        name: 'pko_status',
        description: '检查当前目录是不是 PKO 知识库、缺哪些标准目录、健康度如何。不需要先有知识库。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
            type: 'object',
            properties: {
                isVault: { type: 'boolean' },
                pages: { type: 'number' },
                missingDirs: { type: 'array' },
                findings: { type: 'object' },
            },
        },
        render: (_args, value) => {
            const status = value;
            if (!status.isVault) {
                return text('pko: 当前目录还不是知识库。可以调用 pko_init 初始化，或切换到已有知识库目录。');
            }
            const missing = status.missingDirs.length === 0 ? '无' : `${status.missingDirs.length} 个`;
            return text(`pko: 是知识库，${status.pages} 页，${status.findings.error} error / ${status.findings.warn} warn；缺标准目录：${missing}`);
        },
        needsVault: false,
        run: async (root) => vaultStatus(root),
    },
    {
        name: 'pko_init',
        description: '初始化或补齐 PKO 知识库骨架。先用 plan=true 预览将创建/补齐的清单，把清单展示给用户并得到明确同意后，再不带 plan 执行。只补缺，不覆盖已有文件。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                path: { type: 'string', description: '目标目录，绝对路径或相对会话目录；省略则用当前目录' },
                plan: { type: 'boolean', description: 'true = 只预览不写盘；给用户看清单、确认后再执行' },
                force: { type: 'boolean', description: '目录非空且不像知识库时，是否仍然初始化' },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string' },
                dryRun: { type: 'boolean' },
                plannedDirs: { type: 'number' },
                plannedFiles: { type: 'number' },
                sampleDirs: { type: 'array' },
                sampleFiles: { type: 'array' },
                createdDirs: { type: 'number' },
                createdFiles: { type: 'number' },
                skipped: { type: 'number' },
                missingDirs: { type: 'number' },
                isVault: { type: 'boolean' },
            },
        },
        render: (_args, value) => {
            const result = value;
            const nl = String.fromCharCode(10);
            // 预览：只报清单，绝不写盘
            if (result.dryRun === true) {
                if ((result.plannedDirs ?? 0) === 0 && (result.plannedFiles ?? 0) === 0) {
                    return text(`pko: ${result.target} 结构已完整，无需创建任何内容。`);
                }
                return text([
                    `pko: ${result.target} 的初始化预览（尚未写盘）`,
                    `将新建 ${result.plannedDirs ?? 0} 个目录、${result.plannedFiles ?? 0} 个文件；已有 ${result.skipped} 项会跳过，不覆盖。`,
                    `目录示例：${(result.sampleDirs ?? []).join('、')}`,
                    `文件示例：${(result.sampleFiles ?? []).join('、')}`,
                    '请把这份清单展示给用户；得到明确同意后，再调用 pko_init（不带 plan）执行。',
                ].join(nl));
            }
            // 执行后：结构完整就宣告就绪
            if (result.missingDirs === 0) {
                const head = result.createdDirs === 0 && result.createdFiles === 0
                    ? `pko: ${result.target} 已经是标准结构。`
                    : `pko: 已初始化 ${result.target}，新建 ${result.createdDirs} 个目录、${result.createdFiles} 个文件（跳过已存在的 ${result.skipped} 项）。`;
                return text([
                    head,
                    '库已就绪，无需再检查：结构完整（0 缺失），目录与种子文件齐备。',
                    '不要再用 pko_status / pko_lint / bash 复查目录结构，直接把结果告诉用户即可。',
                    '下一步：需要时读 AGENTS.md 了解写入规范。',
                ].join(nl));
            }
            return text([
                `pko: 已初始化 ${result.target}，新建 ${result.createdDirs} 个目录、${result.createdFiles} 个文件（跳过已存在的 ${result.skipped} 项）。`,
                `注意：仍有 ${result.missingDirs} 个标准目录缺失，可用 pko_status 查看具体缺哪些。`,
            ].join(nl));
        },
        needsVault: false,
        run: async (root, args) => {
            const target = resolveTarget(root, str(args, 'path'));
            const plan = await planScaffold(target);
            if (args.plan === true) {
                return {
                    target,
                    dryRun: true,
                    plannedDirs: plan.dirs.length,
                    plannedFiles: plan.files.length,
                    sampleDirs: plan.dirs.slice(0, 8),
                    sampleFiles: plan.files.slice(0, 8),
                    createdDirs: 0,
                    createdFiles: 0,
                    skipped: plan.existing.length,
                    missingDirs: (await vaultStatus(target)).missingDirs.length,
                    isVault: await hasVaultMarker(target),
                };
            }
            let createdDirs = 0;
            let createdFiles = 0;
            let skipped = plan.existing.length;
            if (plan.dirs.length > 0 || plan.files.length > 0) {
                if (plan.needsForce && args.force !== true) {
                    throw new Error(`pko: ${target} 非空且不像知识库。确认要在这里初始化，请传 force: true。`);
                }
                const result = await applyScaffold(plan, { force: args.force === true });
                createdDirs = result.createdDirs.length;
                createdFiles = result.createdFiles.length;
                skipped = result.skipped.length;
            }
            const status = await vaultStatus(target);
            return { target, createdDirs, createdFiles, skipped, missingDirs: status.missingDirs.length, isVault: status.isVault };
        },
    },
];
/**
 * 注册全部工具。
 * @param ctx 宿主上下文
 * @param config 插件配置
 * @returns 释放函数
 */
export function mountTools(ctx, config) {
    const offs = [];
    for (const spec of TOOL_SPECS) {
        offs.push(ctx.tools.register({
            name: spec.name,
            description: spec.description,
            parameters: spec.parameters,
            output: { schema: spec.outputSchema, render: (args, value) => spec.render(args, value) },
            execute: async (args, exec) => {
                const cwd = cwdOf(exec);
                if (spec.needsVault === false)
                    return spec.run(cwd, args);
                const vault = resolveVault(config.vault, cwd);
                if (vault === undefined) {
                    throw new Error('pko: 当前会话目录不在任何 PKO vault 内。可以调用 pko_init 初始化当前目录，或切换到已有知识库目录。');
                }
                return spec.run(vault, args);
            },
        }));
    }
    return () => { for (const off of offs)
        off(); };
}
