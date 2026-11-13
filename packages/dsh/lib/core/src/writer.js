/**
 * 写入协议：锁 → 版本校验 → 归一化 → 原子写 → 日志 → manifest。
 *
 * 顺序是契约的一部分：先拿锁再读版本，先落文件再记日志，
 * 任何一步失败都不留下"日志说写了、文件其实没写"的状态。
 */
import { realpathSync } from 'node:fs';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { ConflictError, PkoError } from "./errors.js";
import { sha256 } from "./hash.js";
import { acquireLock } from "./lock.js";
import { mergeManifest, readManifest, writeManifest } from "./manifest.js";
import { extraFields, normalizePage, renderPage } from "./normalize.js";
import { normalizeRel } from "./policy.js";
import { vaultPaths } from "./paths.js";
import { parseFrontmatter } from "./schema.js";
import { atomicWrite, readIfExists } from "./store.js";
import { PRODUCED_BY } from "./version.js";
import { categoryOf, stemOf, toPage } from "./vault.js";
/**
 * 日志时间戳：`YYYY-MM-DD HH:mm`。
 * @param date 时间
 * @returns 格式化后的时间戳
 */
export function stamp(date) {
    return date.toISOString().slice(0, 16).replace('T', ' ');
}
/**
 * 追加一行操作日志；文件不存在时创建并写标题。
 * @param logFile 日志文件路径
 * @param line 一行内容
 */
export async function appendLogLine(logFile, line) {
    await mkdir(dirname(logFile), { recursive: true });
    const existing = await readIfExists(logFile);
    if (existing === undefined) {
        await atomicWrite(logFile, `# 操作日志（append-only）\n\n${line}\n`);
        return;
    }
    const separator = existing.endsWith('\n') ? '' : '\n';
    await appendFile(logFile, `${separator}${line}\n`, 'utf8');
}
/**
 * 记录一次写活动，供 Stop 钩子判断是否需要刷新 hot.md。
 * @param activityFile 活动文件路径
 * @param date 活动时间
 */
export async function recordActivity(activityFile, date) {
    await atomicWrite(activityFile, `${JSON.stringify({ ts: date.getTime() })}\n`);
}
/**
 * 判断文件是否存在。
 * @param path 绝对路径
 * @returns 是否存在
 */
export async function existsFile(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
/** 把 extra 字段合并进页面。 */
function applyExtra(page, extra) {
    if (extra === undefined)
        return page;
    const str = (key) => {
        const value = extra[key];
        if (value === undefined)
            return undefined;
        // readonly string[] 不会被 Array.isArray 收窄掉，用 typeof 分支
        return typeof value === 'string' ? value : value.join(', ');
    };
    const tags = extra.tags;
    return {
        ...page,
        title: str('title') ?? page.title,
        type: str('type') ?? page.type,
        status: str('status') ?? page.status,
        confidence: str('confidence') ?? page.confidence,
        tier: str('tier') ?? page.tier,
        tags: tags === undefined ? page.tags : (Array.isArray(tags) ? [...tags] : [tags]),
        source: str('source') ?? page.source,
        summary: str('summary') ?? page.summary,
        created: str('created') ?? page.created,
        updated: str('updated') ?? page.updated,
    };
}
/**
 * 把相对路径解析成 vault 内的绝对路径，越界即拒绝。
 *
 * 这是写路径唯一的落点判定：`relPath` 可能来自模型（工具参数），
 * 不能因为它在 vault 相对路径上看着正常就信任它。
 *
 * @param root vault 根目录
 * @param relPath 原始相对路径
 * @returns 绝对路径
 * @throws PkoError 路径越出 vault
 */
/** 构造越界错误。 */
function escapeError(relPath) {
    return new PkoError('PKO_PATH_ESCAPE', `写入路径越出 vault：${JSON.stringify(relPath)}`);
}
/** 判断一个绝对路径是否落在根目录内（含根本身）。 */
function isInside(rootAbs, candidate) {
    return candidate === rootAbs || candidate.startsWith(`${rootAbs}${sep}`);
}
export function resolveInsideVault(root, relPath) {
    const rel = normalizeRel(relPath);
    // 根目录本身也可能是符号链接（macOS 的 /tmp → /private/tmp），统一用真实路径比较
    let rootAbs = resolve(root);
    try {
        rootAbs = realpathSync(rootAbs);
    }
    catch {
        // 根目录尚不存在：保留字面路径，后续写入会自行创建
    }
    const target = resolve(rootAbs, rel);
    if (rel === '' || isAbsolute(rel) || !isInside(rootAbs, target))
        throw escapeError(relPath);
    // 沿最深已存在祖先取真实路径：vault 内指向外部的符号链接会在这里暴露
    let probe = target;
    for (let depth = 0; depth < 40; depth += 1) {
        try {
            if (!isInside(rootAbs, realpathSync(probe)))
                throw escapeError(relPath);
            return target;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            const parent = dirname(probe);
            if (parent === probe)
                return target;
            probe = parent;
        }
    }
    throw escapeError(relPath);
}
/**
 * 写一个页面。
 * @param input 写入请求
 * @returns 写入结果；内容未变时 `skipped` 为 true
 * @throws ConflictError 版本校验失败
 */
export async function writePage(input) {
    const paths = vaultPaths(input.vault);
    const rel = normalizeRel(input.relPath);
    const target = resolveInsideVault(paths.root, rel);
    const now = input.now ?? new Date();
    const stem = stemOf(rel);
    const lock = await acquireLock(paths.lockFile, { waitMs: input.waitMs });
    try {
        const existing = await readIfExists(target);
        const existingHash = existing === undefined ? undefined : sha256(existing);
        if (input.expectedHash !== undefined && input.expectedHash !== existingHash) {
            throw new ConflictError(rel, input.expectedHash, existingHash);
        }
        const parsed = existing === undefined ? undefined : parseFrontmatter(existing);
        const base = existing === undefined
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
            : { ...toPage(rel, existing), body: input.body };
        const withExtra = applyExtra(base, input.extra);
        const { page: normalized, changed } = normalizePage(withExtra, { stem, now });
        const preserved = { ...extraFields(parsed?.data), ...extraFields(input.extra) };
        let page = normalized;
        let text = renderPage(page, preserved);
        if (existing !== undefined) {
            if (sha256(existing) === sha256(text)) {
                return { relPath: rel, id: page.id, changed: false, skipped: true, filled: [] };
            }
            // 内容确实变了才刷新 updated。归一化（normalize 子命令）只补缺失字段，
            // 不改既有时间戳——那是对元数据的修复，不是内容更新。
            page = { ...page, updated: now.toISOString() };
            text = renderPage(page, preserved);
        }
        await atomicWrite(target, text);
        if (input.silent !== true) {
            await appendLogLine(paths.logFile, `- [${stamp(now)}] write ${rel} (${page.id})`);
        }
        await recordActivity(paths.activityFile, now);
        if (input.sourceKey !== undefined && input.contentHash !== undefined) {
            const manifest = await readManifest(paths.manifestFile);
            await writeManifest(paths.manifestFile, mergeManifest(manifest, input.sourceKey, {
                hash: input.contentHash,
                pages: [page.id],
                lastIngested: now.toISOString(),
                producedBy: PRODUCED_BY,
            }));
        }
        return { relPath: rel, id: page.id, changed: true, skipped: false, filled: changed };
    }
    finally {
        await lock.release();
    }
}
