import { readConfig } from "./config.js";
import { mountEvents } from "./events.js";
import { mountTools } from "./tools.js";
export const name = 'pko-engine';
/** 只硬依赖 tools；其余服务缺省不影响工具注册。 */
export const inject = ['tools'];
/**
 * 挂载插件。
 * @param ctx cordis 上下文
 * @param rawConfig 插件配置
 * @returns 释放函数
 */
export function apply(ctx, rawConfig) {
    const config = readConfig(rawConfig);
    const offs = [];
    /** 单个挂载点失败不拖垮其余能力。 */
    const mount = (label, fn) => {
        try {
            offs.push(fn());
        }
        catch (error) {
            ctx.logger?.warn?.(`[pko] ${label} 挂载失败：${String(error)}`);
        }
    };
    mount('tools', () => mountTools(ctx, config));
    mount('events', () => mountEvents(ctx, config));
    ctx.logger?.info?.(`[pko] 已挂载（vault=${config.vault ?? '按会话目录解析'}）`);
    return () => { for (const off of offs) {
        try {
            off();
        }
        catch { /* 卸载期失败可忽略 */ }
    } };
}
