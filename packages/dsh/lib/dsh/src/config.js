/**
 * 校验并归一化插件配置。
 * @param raw cordis 传入的 config
 * @returns 归一化后的配置
 */
/** 缺省配置：宿主不传 config 时也必须拿到完整默认值。 */
const DEFAULTS = { trigger: false, guard: true, installSkills: true, sessionContext: false, maxInjectTokens: 400 };
export function readConfig(raw) {
    if (typeof raw !== 'object' || raw === null)
        return DEFAULTS;
    const value = raw;
    const vault = typeof value.vault === 'string' && value.vault.trim() !== '' ? value.vault : undefined;
    const trigger = typeof value.trigger === 'boolean' ? value.trigger : false;
    const guard = typeof value.guard === 'boolean' ? value.guard : true;
    const installSkills = typeof value.installSkills === 'boolean' ? value.installSkills : true;
    const sessionContext = typeof value.sessionContext === 'boolean' ? value.sessionContext : false;
    const maxInjectTokens = typeof value.maxInjectTokens === 'number' && Number.isFinite(value.maxInjectTokens)
        ? Math.max(50, Math.floor(value.maxInjectTokens))
        : 400;
    return { ...(vault === undefined ? {} : { vault }), trigger, guard, installSkills, sessionContext, maxInjectTokens };
}
