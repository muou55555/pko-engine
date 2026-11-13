/**
 * 三档上下文：会话档 / 任务档 / 整页档。
 *
 * 分档而不是一次性全量注入，是因为「知识库的价值取决于它在正确的时机出现」：
 * 会话档告诉模型"有库"，任务档告诉它"这一页相关"，整页档只在上一档被忽略后才给。
 * 预算逐档放大，但都是显式上限，不允许无界注入。
 */
import { join } from 'node:path';
import { vaultPaths } from "./paths.js";
import { retrieve } from "./retrieve.js";
import { readIfExists } from "./store.js";
import { clipToTokens, estimateTokens } from "./tokens.js";
import { scanVault, stemOf } from "./vault.js";
/** 各档默认预算（token）。 */
export const DEFAULT_BUDGET = {
    session: 400,
    task: 200,
    full: 1200,
};
/** 把命中词渲染成「命中：a、b」，最多 4 个。 */
function hitsLabel(candidate) {
    return candidate.matchedBy === 'graph' ? '（关联）' : `（${candidate.matchedBy}）`;
}
/**
 * 会话档：库身份 + hot.md + north-star。
 * @param vault vault 根目录
 * @param options 预算
 * @returns 上下文块；库为空时返回 undefined
 */
export async function sessionContext(vault, options = {}) {
    const budget = options.maxTokens ?? DEFAULT_BUDGET.session;
    const paths = vaultPaths(vault);
    const hot = await readIfExists(paths.hotFile);
    const northStar = await readIfExists(join(vault, 'brain', 'north-star.md'));
    const sources = [];
    const parts = [];
    if (hot !== undefined && hot.trim() !== '') {
        parts.push(hot.trim());
        sources.push('50-Wiki/hot.md');
    }
    if (northStar !== undefined && northStar.trim() !== '') {
        parts.push(`当前目标：\n${northStar.trim()}`);
        sources.push('brain/north-star.md');
    }
    if (parts.length === 0)
        return undefined;
    const header = '[知识库] 本工作区有 PKO vault。\n\n';
    const raw = `${header}${parts.join('\n\n')}`;
    const clipped = clipToTokens(raw, budget);
    return { tier: 'session', text: clipped.text, tokens: estimateTokens(clipped.text), sources };
}
/**
 * 任务档：按任务原文召回 top-N 页面。
 *
 * 命中不足时返回 undefined——宁可不说话，也不要塞一堆不相关的路径当噪声。
 *
 * @param vault vault 根目录
 * @param task 任务原文（通常是用户这一轮说的话）
 * @param options 预算与候选数
 * @returns 上下文块或 undefined
 */
export async function taskContext(vault, task, options = {}) {
    if (task.trim() === '')
        return undefined;
    const budget = options.maxTokens ?? DEFAULT_BUDGET.task;
    const limit = options.limit ?? 3;
    const result = await retrieve(vault, task, { maxCandidates: limit });
    if (result.candidates.length === 0)
        return undefined;
    const lines = result.candidates.map((candidate) => {
        const page = { path: candidate.path, title: candidate.title };
        return `- ${page.path} — ${page.title}${hitsLabel(candidate)}`;
    });
    const text = `[知识库提示] 与本任务相关的页面（${result.candidates.length} 条）：\n${lines.join('\n')}\n建议动手前扫一眼；确认无关请忽略。`;
    const clipped = clipToTokens(text, budget);
    return {
        tier: 'task',
        text: clipped.text,
        tokens: estimateTokens(clipped.text),
        sources: result.candidates.map((candidate) => candidate.path),
    };
}
/**
 * 整页档：把某一页正文投给模型（上一档被忽略时才用）。
 * @param vault vault 根目录
 * @param id 页面 id
 * @param options 预算
 * @returns 上下文块或 undefined
 */
export async function bodyContext(vault, id, options = {}) {
    const budget = options.maxTokens ?? DEFAULT_BUDGET.full;
    const { pages } = await scanVault(vault);
    const page = pages.find((candidate) => candidate.id === id || stemOf(candidate.path) === id);
    if (page === undefined || page.body.trim() === '')
        return undefined;
    const raw = `[知识库提示] 页面正文（${page.path} — ${page.title}）：\n\n${page.body}`;
    const clipped = clipToTokens(raw, budget);
    return { tier: 'full', text: clipped.text, tokens: estimateTokens(clipped.text), sources: [page.path] };
}
