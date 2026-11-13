/** 插件配置：全部字段可空，缺省按会话目录推导。 */
export interface PkoConfig {
  /** 固定 vault 绝对路径；为空则按会话 cwd 向上查找。 */
  readonly vault?: string
  /** 是否启用任务级召回，默认 true。 */
  readonly trigger?: boolean
  /** 注入预算（token），默认 400。 */
  readonly maxInjectTokens?: number
  /** 是否启用文件闸门，默认 true。 */
  readonly guard?: boolean
  /** 会话开始时把随包技能投放到 vault，默认 true。 */
  readonly installSkills?: boolean
}

/**
 * 校验并归一化插件配置。
 * @param raw cordis 传入的 config
 * @returns 归一化后的配置
 */
export function readConfig(raw: unknown): PkoConfig {
  if (typeof raw !== 'object' || raw === null) return {}
  const value = raw as Record<string, unknown>
  const vault = typeof value.vault === 'string' && value.vault.trim() !== '' ? value.vault : undefined
  const trigger = typeof value.trigger === 'boolean' ? value.trigger : true
  const guard = typeof value.guard === 'boolean' ? value.guard : true
  const installSkills = typeof value.installSkills === 'boolean' ? value.installSkills : true
  const maxInjectTokens = typeof value.maxInjectTokens === 'number' && Number.isFinite(value.maxInjectTokens)
    ? Math.max(50, Math.floor(value.maxInjectTokens))
    : 400
  return { ...(vault === undefined ? {} : { vault }), trigger, guard, installSkills, maxInjectTokens }
}
