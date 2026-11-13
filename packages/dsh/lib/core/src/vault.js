/** vault 扫描：目录 → 分类映射、页面解析、文件清单。 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { listOf, normalizeConfidence, normalizeTier, parseFrontmatter, textOf } from "./schema.js";
import { extractLinks } from "./links.js";
/** 不参与扫描的目录。点号开头的一律跳过，无需列出。 */
export const IGNORED_DIRS = ['_templates', '_attachments', 'node_modules'];
/** 元数据工件：导航目录、操作日志、上下文缓存。它们是派生/人工维护的，不是知识页。 */
export const META_PATHS = new Set([
    '50-Wiki/index.md',
    '50-Wiki/log.md',
    '50-Wiki/hot.md',
]);
/**
 * 不参与页面审计的根级文件。
 *
 * 这些是运维文档（操作手册、仓库说明），不是知识页；要求它们带 frontmatter
 * 只会制造噪声。它们仍进入文件清单，作为链接目标的判定依据。
 */
export const IGNORED_ROOT_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md'];
/** 目录前缀 → 检索分类。顺序即优先级，先到先判。 */
const CATEGORY_RULES = [
    ['20-Projects/', 'projects'],
    ['30-Areas/', 'areas'],
    ['40-Resources/concepts/', 'concepts'],
    ['40-Resources/how-to/', 'howto'],
    ['40-Resources/references/', 'references'],
    ['40-Resources/clips/', 'clips'],
    ['50-Wiki/', 'synthesis'],
    ['60-Outputs/', 'outputs'],
    ['70-Calendar/', 'daily'],
    ['80-Cards/', 'cards'],
    ['90-Archive/', 'archive'],
    ['10-Atlas/', 'moc'],
    ['00-Inbox/', 'inbox'],
    ['brain/', 'memory'],
];
/**
 * 判断一个路径是否是可归一化的知识页。
 *
 * 非 `.md`、元数据工件、根级运维文档、被忽略目录下的文件都不算。
 * hook 的自动归一化与检索面都走这一个判定，避免两处各写一套规则。
 *
 * @param relPath vault 内相对路径
 * @returns 是否按知识页对待
 */
export function isPagePath(relPath) {
    const rel = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!rel.endsWith('.md'))
        return false;
    if (META_PATHS.has(rel))
        return false;
    if (IGNORED_ROOT_FILES.includes(rel))
        return false;
    const segments = rel.split('/');
    const head = segments[0];
    if (segments.length > 1 && head !== undefined && IGNORED_DIRS.includes(head))
        return false;
    return true;
}
/**
 * 由相对路径派生检索分类。
 * @param relPath 相对 vault 根、以 `/` 分隔的路径
 * @returns 分类名；未命中任何规则时为 `other`
 */
export function categoryOf(relPath) {
    for (const [prefix, category] of CATEGORY_RULES) {
        if (relPath.startsWith(prefix))
            return category;
    }
    return 'other';
}
/**
 * 取文件名去扩展名后的标识。
 * @param relPath 相对路径
 * @returns 文件名主干
 */
export function stemOf(relPath) {
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    return name.endsWith('.md') ? name.slice(0, -3) : name;
}
/**
 * 把一份文件文本解析为页面。
 * @param relPath 相对 vault 根的路径
 * @param text 文件全文
 * @returns 页面对象；无 frontmatter 时字段为空且 `hasFrontmatter` 为 false
 */
export function toPage(relPath, text) {
    const parsed = parseFrontmatter(text);
    const data = parsed?.data ?? {};
    const body = parsed?.body ?? text;
    const id = textOf(data.id);
    return {
        id: id === '' ? stemOf(relPath) : id,
        title: textOf(data.title),
        type: textOf(data.type),
        status: textOf(data.status) || undefined,
        confidence: normalizeConfidence(textOf(data.confidence)),
        tier: normalizeTier(textOf(data.tier)),
        tags: listOf(data.tags),
        source: textOf(data.source) || undefined,
        summary: textOf(data.summary) || undefined,
        created: textOf(data.created) || undefined,
        updated: textOf(data.updated) || undefined,
        path: relPath,
        category: categoryOf(relPath),
        body,
        links: extractLinks(body),
        hasFrontmatter: parsed !== undefined,
    };
}
/**
 * 递归扫描一个 vault（只读）。
 * @param root vault 根目录的绝对路径
 * @returns 页面与文件清单，均按路径排序
 */
export async function scanVault(root) {
    const pages = [];
    const files = [];
    const walk = async (dir) => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.'))
                continue;
            const abs = join(dir, entry.name);
            const rel = relative(root, abs).split(sep).join('/');
            if (entry.isDirectory()) {
                if (IGNORED_DIRS.includes(entry.name))
                    continue;
                await walk(abs);
                continue;
            }
            if (!entry.isFile())
                continue;
            files.push(rel);
            if (!entry.name.endsWith('.md'))
                continue;
            if (dir === root && IGNORED_ROOT_FILES.includes(entry.name))
                continue;
            pages.push(toPage(rel, await readFile(abs, 'utf8')));
        }
    };
    await walk(root);
    return { root, pages, files };
}
