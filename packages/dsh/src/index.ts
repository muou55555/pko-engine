/** @pko/dsh 插件入口：装配工具与事件，其余交给 core。 */
import type { PkoConfig } from './config.ts'
import { readConfig } from './config.ts'
import { mountEvents } from './events.ts'
import { mountTools } from './tools.ts'

export const name = 'pko-engine'

/** 只硬依赖 tools；其余服务缺省不影响工具注册。 */
export const inject = ['tools']

export interface HostContext {
  tools: Parameters<typeof mountTools>[0]['tools']
  on(event: string, handler: (...args: never[]) => unknown): unknown
  logger?: { info?(message: string): void; warn?(message: string): void }
}

/**
 * 挂载插件。
 * @param ctx cordis 上下文
 * @param rawConfig 插件配置
 * @returns 释放函数
 */
export function apply(ctx: HostContext, rawConfig?: unknown): () => void {
  const config: PkoConfig = readConfig(rawConfig)
  const offs: Array<() => void> = []

  /** 单个挂载点失败不拖垮其余能力。 */
  const mount = (label: string, fn: () => () => void): void => {
    try {
      offs.push(fn())
    } catch (error) {
      ctx.logger?.warn?.(`[pko] ${label} 挂载失败：${String(error)}`)
    }
  }

  mount('tools', () => mountTools(ctx, config))
  mount('events', () => mountEvents(ctx, config))

  ctx.logger?.info?.(`[pko] 已挂载（vault=${config.vault ?? '按会话目录解析'}）`)
  return () => { for (const off of offs) { try { off() } catch { /* 卸载期失败可忽略 */ } } }
}
