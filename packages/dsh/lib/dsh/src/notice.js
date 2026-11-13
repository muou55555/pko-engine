/**
 * 构造注入用的 user 消息。
 *
 * 不 import 宿主的 `createUserMessage`：第三方插件在生产 profile 里解析不到
 * `@deepseek-ai/*`。宿主实现的本质是 `{ id, role:'user', content, source }`，
 * 这里按同样形状字面量构造，失败由调用方吞掉（触发层是增益，不是依赖）。
 */
import { randomUUID } from 'node:crypto';
/**
 * 构造一条 user 角色上下文消息。
 * @param text 注入文本
 * @returns 宿主可直接接收的消息对象
 */
export function userNotice(text) {
    return {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
    };
}
