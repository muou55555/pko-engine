/** 一个 vault 内部的固定路径。所有模块只从这里取路径，不各自拼。 */
import { join } from 'node:path';
/**
 * 派生 vault 的路径表。
 * @param root vault 根目录（绝对路径）
 * @returns 固定路径集合
 */
export function vaultPaths(root) {
    const pkoDir = join(root, '.pko');
    return {
        root,
        pkoDir,
        lockFile: join(pkoDir, 'lock.json'),
        manifestFile: join(pkoDir, 'manifest.json'),
        activityFile: join(pkoDir, 'activity.json'),
        logFile: join(root, '50-Wiki', 'log.md'),
        hotFile: join(root, '50-Wiki', 'hot.md'),
        indexPath: join(root, '50-Wiki', 'index.md'),
    };
}
