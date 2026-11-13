import { CONFIDENCES, TIERS } from "./types.js";
/** 契约字段。渲染时其余字段原样保留，避免改写时丢失外部工具写入的元数据。 */
export const KNOWN_KEYS = [
    'id', 'title', 'type', 'status', 'confidence', 'tier', 'tags', 'source', 'summary', 'created', 'updated',
];
/**
 * 正文摘要：首个非空、非标题、非表格、非分隔线的行，截 60 字。
 * @param body 页面正文
 * @returns 摘要；正文无可摘内容时为空串
 */
export function summarizeBody(body) {
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (line === '')
            continue;
        if (line.startsWith('#') || line.startsWith('|') || line.startsWith('---'))
            continue;
        return [...line].slice(0, 60).join('');
    }
    return '';
}
/**
 * 取正文第一个标题，作为缺失 title 的兜底。
 * @param body 页面正文
 * @returns 标题文本或 undefined
 */
export function firstHeading(body) {
    const match = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
    return match?.[1];
}
/**
 * 取出契约之外的原文字段，用于原样写回。
 * @param data 解析出的 frontmatter 记录
 * @returns 只含非契约字段的记录
 */
export function extraFields(data) {
    if (data === undefined)
        return {};
    const extra = {};
    for (const [key, value] of Object.entries(data)) {
        if (!KNOWN_KEYS.includes(key))
            extra[key] = value;
    }
    return extra;
}
/**
 * 补齐缺失的契约字段。
 *
 * 只补"能从上下文确定"的字段，不臆造内容：
 * title 取首个标题或文件名，type 缺省 note，summary 取正文首行。
 *
 * @param page 原始页面
 * @param options.stem 文件名主干（id 与 title 的兜底）
 * @param options.now 注入时钟，便于测试
 * @returns 归一化后的页面与被补字段
 */
export function normalizePage(page, options) {
    const now = (options.now ?? new Date()).toISOString();
    const changed = [];
    let title = page.title;
    if (title === '') {
        title = firstHeading(page.body) ?? options.stem;
        changed.push('title');
    }
    let type = page.type;
    if (type === '') {
        type = 'note';
        changed.push('type');
    }
    let created = page.created;
    if (created === undefined) {
        created = now;
        changed.push('created');
    }
    let updated = page.updated;
    if (updated === undefined) {
        updated = created;
        changed.push('updated');
    }
    let summary = page.summary;
    if (summary === undefined) {
        const derived = summarizeBody(page.body);
        if (derived !== '') {
            summary = derived;
            changed.push('summary');
        }
    }
    const confidence = CONFIDENCES.includes(page.confidence ?? '')
        ? page.confidence
        : page.confidence;
    const tier = TIERS.includes(page.tier) ? page.tier : 'supporting';
    return {
        page: { ...page, title, type, status: page.status, confidence, tier, created, updated, summary },
        changed,
    };
}
/**
 * 渲染为完整文件文本（frontmatter + 正文），契约字段顺序固定，其余字段原样追加。
 * @param page 页面
 * @param preserved 需原样保留的非契约字段
 * @returns 文件全文，以单个换行结尾
 */
export function renderPage(page, preserved = {}) {
    const fields = [
        ['id', page.id],
        ['title', page.title],
        ['type', page.type],
        ['status', page.status],
        ['confidence', page.confidence],
        ['tier', page.tier],
        ['tags', page.tags.length > 0 ? page.tags : undefined],
        ['source', page.source],
        ['summary', page.summary],
        ['created', page.created],
        ['updated', page.updated],
    ];
    const lines = ['---'];
    for (const [key, value] of fields) {
        if (value === undefined)
            continue;
        lines.push(Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`);
    }
    for (const [key, value] of Object.entries(preserved)) {
        if (value === undefined)
            continue;
        lines.push(Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`);
    }
    lines.push('---', '');
    return `${lines.join('\n')}\n${page.body.trim()}\n`;
}
