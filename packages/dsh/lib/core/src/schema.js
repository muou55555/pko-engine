import { TIERS } from "./types.js";
// 用 m 标志让终止符匹配「行首的 ---」，这样空 frontmatter 块（`---\n---`）也能被识别。
// 旧写法要求终止符前面必须有一个换行，空块因此完全不匹配，归一化时会再补一个块，造成重复。
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;
/**
 * 解析一份 Markdown 文件的 frontmatter。
 * @param text 文件全文
 * @returns 解析结果；没有合法 `---` 围栏块时返回 undefined
 */
export function parseFrontmatter(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const match = FRONTMATTER.exec(normalized);
    if (!match)
        return undefined;
    const data = {};
    let listKey;
    for (const line of (match[1] ?? '').split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        const item = /^-\s+(.*)$/.exec(trimmed);
        if (item !== null) {
            if (listKey !== undefined) {
                const current = data[listKey];
                const list = Array.isArray(current) ? current : current === undefined ? [] : [current];
                list.push(stripQuotes(item[1].trim()));
                data[listKey] = list;
            }
            continue;
        }
        const entry = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
        if (entry === null)
            continue;
        listKey = entry[1];
        data[entry[1]] = parseScalar(entry[2].trim());
    }
    return { data, body: normalized.slice(match[0].length).trim() };
}
/** 去掉成对引号。 */
function stripQuotes(value) {
    if (value.length < 2)
        return value;
    const quoted = (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"));
    return quoted ? value.slice(1, -1) : value;
}
/** 标量或内联数组。 */
function parseScalar(value) {
    if (!value.startsWith('[') || !value.endsWith(']'))
        return stripQuotes(value);
    const inner = value.slice(1, -1).trim();
    if (inner === '')
        return [];
    return inner
        .split(',')
        .map((part) => stripQuotes(part.trim()))
        .filter((part) => part !== '');
}
/**
 * 取单值字段。
 * @param value 解析出的原始值
 * @returns 字符串；数组用逗号连接，缺省为空串
 */
export function textOf(value) {
    if (value === undefined)
        return '';
    return Array.isArray(value) ? value.join(', ') : value;
}
/**
 * 取列表字段。
 * @param value 解析出的原始值
 * @returns 字符串数组；块列表与内联数组等价
 */
export function listOf(value) {
    if (value === undefined)
        return [];
    if (Array.isArray(value))
        return [...value];
    const trimmed = value.trim();
    return trimmed === '' ? [] : [trimmed];
}
/**
 * 归一化 tier：无法识别时回退 supporting。
 * @param value 原始字符串
 * @returns 合法分层
 */
export function normalizeTier(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    return TIERS.includes(normalized) ? normalized : 'supporting';
}
/**
 * 归一化 confidence：无法识别时返回 undefined（由 doctor 负责告警）。
 * @param value 原始字符串
 * @returns 合法取值或 undefined
 */
export function normalizeConfidence(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized === 'extracted' || normalized === 'inferred' || normalized === 'ambiguous')
        return normalized;
    return undefined;
}
