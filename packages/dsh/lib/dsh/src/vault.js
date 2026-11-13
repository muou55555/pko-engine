/** 按会话目录解析 vault：不缓存全局状态，避免跨工作区串库。 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// 识别标记按"多强信号"排列：`.pko/` 是我们自己的状态目录，最可靠；
// 其次是 50-Wiki 目录本身（PKO 骨架存在的证据），最后才是索引文件——
// 只有 index.md 会导致"还没建索引的新库"识别不出来（真实会话里踩到）。
const MARKERS = ['.pko', '50-Wiki', join('50-Wiki', 'index.md')];
/**
 * 从某个目录向上找最近的 PKO vault 根。
 * @param from 起始目录（会话 cwd）
 * @returns vault 根绝对路径；找不到返回 undefined
 */
export function nearestVault(from) {
    let current = resolve(from);
    for (let depth = 0; depth < 12; depth += 1) {
        if (MARKERS.some((marker) => existsSync(join(current, marker))))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
    return undefined;
}
/**
 * 解析本次调用应当使用的 vault。
 * @param configured 配置里的固定路径
 * @param cwd 会话当前目录
 * @returns vault 根或 undefined
 */
export function resolveVault(configured, cwd) {
    if (configured !== undefined) {
        const fixed = resolve(configured);
        return existsSync(fixed) ? fixed : undefined;
    }
    return nearestVault(cwd);
}
