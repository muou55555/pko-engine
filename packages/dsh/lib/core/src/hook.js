/**
 * 宿主钩子的统一入口。
 *
 * Claude Code 的 settings.json 把 5 个 shell 脚本换成 `pko hook` 一个命令：
 * 它从 stdin 读同一份 JSON、按同一个事件名分派、用同样的 exit 2 表达拒绝。
 * DSH 侧不经过这里（它有自己的类型化事件），但两边调用的是同一组 policy 与 writer。
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';
import { acquireLock } from "./lock.js";
import { extraFields, normalizePage, renderPage } from "./normalize.js";
import { vaultPaths } from "./paths.js";
import { checkBash, checkWrite } from "./policy.js";
import { atomicWrite, readIfExists } from "./store.js";
import { parseFrontmatter } from "./schema.js";
import { isPagePath, toPage, stemOf } from "./vault.js";
import { existsFile, recordActivity, resolveInsideVault } from "./writer.js";
import { taskContext } from "./context.js";
const OK = { exit: 0, stdout: '', stderr: '' };
/** 截断到指定字符数，超出时加省略号。 */
function clip(text, limit) {
    return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`;
}
/**
 * 工具名归一化。
 *
 * Claude Code 的 payload 传 `Write` / `Edit` / `MultiEdit`（首字母大写），
 * DSH 的工具名是全小写。统一转小写后再判定，否则闸门在真实会话里静默失效。
 *
 * @param input 钩子 payload
 * @returns 归一化后的工具名
 */
function toolNameOf(input) {
    const raw = typeof input.tool_name === 'string' ? input.tool_name.toLowerCase() : '';
    return raw === 'multiedit' || raw === 'notebookedit' ? 'edit' : raw;
}
/** 类型收窄：普通对象。 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 把工具给的路径转成 vault 内相对路径；不在 vault 内返回 undefined。 */
function toRel(vault, file) {
    const abs = isAbsolute(file) ? resolve(file) : resolve(vault, file);
    const rel = relative(vault, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
        return undefined;
    return rel.split(sep).join('/');
}
/** SessionStart：注入 hot.md 与 north-star。 */
async function sessionStart(options) {
    const paths = vaultPaths(options.vault);
    const hot = await readIfExists(paths.hotFile);
    const northStar = await readIfExists(join(options.vault, 'brain', 'north-star.md'));
    const parts = [];
    if (hot !== undefined)
        parts.push(clip(hot.trim(), 700));
    if (northStar !== undefined && northStar.trim() !== '')
        parts.push(`当前目标：\n${clip(northStar.trim(), 300)}`);
    if (parts.length === 0)
        return OK;
    return { exit: 0, stdout: `[知识库] 本工作区有 PKO vault。\n\n${parts.join('\n\n')}\n`, stderr: '' };
}
/** PreToolUse：校验写目标与 shell 命令。 */
async function preTool(options, input) {
    const tool = toolNameOf(input);
    const args = isRecord(input.tool_input) ? input.tool_input : {};
    if (tool === 'write' || tool === 'edit') {
        const file = typeof args.file_path === 'string' ? args.file_path : '';
        if (file === '')
            return OK;
        const rel = toRel(options.vault, file);
        if (rel === undefined)
            return OK;
        const verdict = checkWrite({ relPath: rel, tool, exists: await existsFile(resolve(options.vault, rel)) });
        if (!verdict.allow)
            return { exit: 2, stdout: '', stderr: `${verdict.reason}\n${verdict.suggestion}\n` };
        return OK;
    }
    if (tool === 'bash') {
        const command = typeof args.command === 'string' ? args.command : '';
        const verdict = checkBash(command);
        if (!verdict.allow)
            return { exit: 2, stdout: '', stderr: `${verdict.reason}\n${verdict.suggestion}\n` };
    }
    return OK;
}
/** PostToolUse：把裸写落地的文件归一化。 */
async function postTool(options, input) {
    const tool = toolNameOf(input);
    if (tool !== 'write' && tool !== 'edit')
        return OK;
    const args = isRecord(input.tool_input) ? input.tool_input : {};
    const file = typeof args.file_path === 'string' ? args.file_path : '';
    if (file === '')
        return OK;
    const rel = toRel(options.vault, file);
    if (rel === undefined)
        return OK;
    // 只归一化知识页：log.md 是 append-only、hot.md 是人工缓存、非 .md 可能是二进制，
    // 给它们加 frontmatter 会破坏内容
    if (!isPagePath(rel))
        return OK;
    let abs;
    try {
        abs = resolveInsideVault(options.vault, rel);
    }
    catch {
        return OK; // 越界或指向 vault 外的符号链接：不动它
    }
    const now = options.now ?? new Date();
    const paths = vaultPaths(options.vault);
    const lock = await acquireLock(paths.lockFile);
    try {
        const text = await readIfExists(abs);
        if (text === undefined)
            return OK;
        const { page, changed } = normalizePage(toPage(rel, text), { stem: stemOf(rel), now });
        if (changed.length === 0)
            return OK;
        await atomicWrite(abs, renderPage(page, extraOf(text)));
        await recordActivity(paths.activityFile, now);
        return { exit: 0, stdout: `[pko] 已补齐 frontmatter：${changed.join('、')}（${rel}）\n`, stderr: '' };
    }
    finally {
        await lock.release();
    }
}
/**
 * UserPromptSubmit：按用户这一轮的原话召回相关知识。
 *
 * Claude Code 侧靠这个钩子获得「该查的时候提醒你」的能力，
 * 语义上与 DSH 的 `agent/pre-step` 对齐。
 */
async function promptSubmit(options, input) {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (prompt.trim() === '')
        return OK;
    const context = await taskContext(options.vault, prompt);
    if (context === undefined)
        return OK;
    return { exit: 0, stdout: `${context.text}\n`, stderr: '' };
}
/** Stop：vault 有改动但 hot.md 未更新时提醒。 */
async function stop(options) {
    const paths = vaultPaths(options.vault);
    const raw = await readIfExists(paths.activityFile);
    if (raw === undefined)
        return OK;
    let ts = 0;
    try {
        const parsed = JSON.parse(raw);
        ts = Number(parsed.ts ?? 0);
    }
    catch {
        return OK;
    }
    let hotMtime = 0;
    try {
        hotMtime = (await stat(paths.hotFile)).mtimeMs;
    }
    catch {
        hotMtime = 0;
    }
    if (ts > hotMtime) {
        return { exit: 0, stdout: '[知识库] 本次会话改动过 vault，建议更新 50-Wiki/hot.md（≤500 字，完整覆写）。\n', stderr: '' };
    }
    return OK;
}
/** 从文件原文取出非契约字段。 */
function extraOf(text) {
    return extraFields(parseFrontmatter(text)?.data);
}
/**
 * 执行一次钩子调用。
 * @param rawInput stdin 原文（Claude Code hook JSON）
 * @param options.vault vault 根目录
 * @returns 退出码与输出；exit 2 表示拒绝
 */
export async function runHook(rawInput, options) {
    let input;
    try {
        const parsed = JSON.parse(rawInput);
        if (!isRecord(parsed))
            return OK;
        input = parsed;
    }
    catch {
        return OK;
    }
    const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
    switch (event) {
        case 'SessionStart':
            return sessionStart(options);
        case 'PreToolUse':
            return preTool(options, input);
        case 'PostToolUse':
            return postTool(options, input);
        case 'UserPromptSubmit':
            return promptSubmit(options, input);
        case 'Stop':
            return stop(options);
        default:
            return OK;
    }
}
