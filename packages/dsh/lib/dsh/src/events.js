/**
 * 宿主事件接线。
 *
 * 三处锚点，各有依据：
 *   agent/created     会话开始时注入库上下文（不是 agent/session-start——0.2.2 没有这个事件）
 *   agent/pre-step    任务级召回；先调用 next() 再补充，不打断宿主决策
 *   tools/pre-execute 写入治理；fs/*-intent 只表达版本守卫，没有拒绝语义，硬拦截只能走这里
 */
import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { resolveVault } from "./vault.js";
import { userNotice } from "./notice.js";
import { ensureSkills } from "./skills.js";
import { sessionContext, taskContext } from "../../core/src/context.js";
import { checkBash, checkWrite, normalizeRel } from "../../core/src/policy.js";
/** 会话目录。 */
function cwdOf(agent) {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === 'string' ? cwd : process.cwd();
}
/** 取一条消息里的纯文本。 */
function contentText(content) {
    if (typeof content === 'string')
        return content.trim();
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        const text = block.text;
        if (typeof block === 'object' && block !== null && typeof text === 'string')
            parts.push(text);
    }
    return parts.join('\n').trim();
}
/**
 * 取出本步的**最新用户原文**。
 *
 * 只取最后一条 user 消息，不能拼接整段历史：决策里带的可能是累积对话，
 * 用全文做召回会让每一步都命中前面聊过的话题，于是同一个提示被反复注入，
 * 而真正的新问题反而被淹没（真实会话里观察到模型说"这已是第三次出现同一条提示"）。
 */
function decisionText(decision) {
    const record = decision;
    const messages = record?.messages;
    if (!Array.isArray(messages))
        return '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message === undefined)
            continue;
        if (typeof message.role === 'string' && message.role !== 'user')
            continue;
        const text = contentText(message.content);
        if (text !== '')
            return text.slice(0, 2000);
    }
    return '';
}
/** 判断路径是否在 vault 内，并返回相对路径。 */
function relInsideVault(vault, path) {
    const abs = resolve(path);
    const rel = relative(vault, abs);
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`))
        return undefined;
    return rel.split(sep).join('/');
}
/**
 * 注册全部事件监听。
 * @param ctx 宿主上下文
 * @param config 插件配置
 * @returns 释放函数（宿主会随插件卸载自动清理，这里只做对称收尾）
 */
export function mountEvents(ctx, config) {
    const offs = [];
    const lastTask = new WeakMap();
    /** 单条注册失败不扩散。 */
    const on = (event, handler) => {
        try {
            const off = ctx.on(event, handler);
            if (typeof off === 'function')
                offs.push(off);
        }
        catch (error) {
            ctx.logger?.warn?.(`[pko] 订阅 ${event} 失败：${String(error)}`);
        }
    };
    // ---- 会话开始：注入库上下文 ----
    on('agent/created', (async (payload) => {
        const agent = payload?.agent;
        if (agent?.inject === undefined)
            return;
        try {
            const vault = resolveVault(config.vault, cwdOf(agent));
            if (vault === undefined)
                return;
            if (config.installSkills !== false) {
                try {
                    const result = ensureSkills(vault);
                    if (result.installed.length > 0) {
                        ctx.logger?.info?.(`[pko] 已投放 ${result.installed.length} 个技能：${result.installed.join(', ')}`);
                    }
                }
                catch (error) {
                    ctx.logger?.warn?.(`[pko] 技能投放失败：${String(error)}`);
                }
            }
            const context = await sessionContext(vault, { maxTokens: config.maxInjectTokens });
            if (context === undefined)
                return;
            agent.inject(userNotice(context.text));
        }
        catch (error) {
            ctx.logger?.warn?.(`[pko] 会话注入失败：${String(error)}`);
        }
    }));
    // ---- 任务级召回 ----
    if (config.trigger !== false) {
        on('agent/pre-step', (async (payload, next) => {
            const decision = await next();
            try {
                const agent = payload?.agent;
                if (agent?.inject === undefined)
                    return decision;
                const text = decisionText(decision);
                if (text === '')
                    return decision;
                const key = agent;
                if (lastTask.get(key) === text)
                    return decision;
                lastTask.set(key, text);
                const vault = resolveVault(config.vault, cwdOf(agent));
                if (vault === undefined)
                    return decision;
                const context = await taskContext(vault, text, { maxTokens: Math.min(config.maxInjectTokens ?? 400, 200) });
                if (context === undefined)
                    return decision;
                agent.inject(userNotice(context.text));
            }
            catch (error) {
                ctx.logger?.warn?.(`[pko] 任务召回失败：${String(error)}`);
            }
            return decision;
        }));
    }
    // ---- 写入治理 ----
    if (config.guard !== false) {
        on('tools/pre-execute', (async (exec, next) => {
            const decision = await next();
            try {
                const name = typeof exec?.name === 'string' ? exec.name : '';
                const args = (exec?.arguments ?? {});
                const vault = resolveVault(config.vault, cwdOf(exec?.agent));
                if (vault === undefined)
                    return decision;
                if (name === 'write' || name === 'edit') {
                    const file = typeof args.file_path === 'string' ? args.file_path : '';
                    if (file === '')
                        return decision;
                    const rel = relInsideVault(vault, file);
                    if (rel === undefined)
                        return decision;
                    const verdict = checkWrite({ relPath: normalizeRel(rel), tool: name, exists: existsSync(file) });
                    if (!verdict.allow)
                        return { kind: 'deny', reason: `${verdict.reason}\n${verdict.suggestion}` };
                }
                else if (name === 'bash') {
                    const command = typeof args.command === 'string' ? args.command : '';
                    const verdict = checkBash(command);
                    if (!verdict.allow)
                        return { kind: 'deny', reason: `${verdict.reason}\n${verdict.suggestion}` };
                }
            }
            catch (error) {
                ctx.logger?.warn?.(`[pko] 闸门判定失败：${String(error)}`);
            }
            return decision;
        }));
    }
    return () => { for (const off of offs) {
        try {
            off();
        }
        catch { /* 卸载期失败可忽略 */ }
    } };
}
