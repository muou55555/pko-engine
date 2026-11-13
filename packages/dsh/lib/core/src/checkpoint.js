/**
 * 还原点：用 git ref 记录一份可回滚的快照。
 *
 * 选 git ref 而不是复制目录：vault 本来就是 git 仓库，快照天然增量，
 * 代价接近零。`git stash create` 会生成提交对象但**不动工作区与索引**。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PkoError } from "./errors.js";
const run = promisify(execFile);
/** 还原点引用前缀。 */
const REF_PREFIX = 'refs/pko/ckpt';
/** 还原点 id：`YYYYMMDD-HHmmss`（不含冒号，可安全用于 ref 名）。 */
function checkpointId(now) {
    const iso = now.toISOString();
    return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}
/** 执行 git 并返回 stdout。 */
async function git(vault, args) {
    const result = await run('git', ['-C', vault, ...args]);
    return result.stdout.trim();
}
/**
 * 判断目录是否是 git 仓库。
 * @param vault vault 根目录
 * @returns 是否可用还原点功能
 */
export async function isGitRepo(vault) {
    try {
        await git(vault, ['rev-parse', '--git-dir']);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 创建一个还原点。
 *
 * 工作区有未提交改动时记录当时的完整树；干净时记录 HEAD。
 * 两种情况下都不修改工作区、索引或当前分支。
 *
 * @param vault vault 根目录
 * @param now 注入时钟（便于测试）
 * @returns 新建的还原点
 * @throws PkoError 不是 git 仓库或没有可记录的提交
 */
export async function createCheckpoint(vault, now = new Date()) {
    if (!await isGitRepo(vault)) {
        throw new PkoError('PKO_NOT_GIT', '该 vault 不是 git 仓库，无法创建还原点');
    }
    let sha = '';
    try {
        sha = await git(vault, ['stash', 'create']);
    }
    catch {
        sha = '';
    }
    if (sha === '') {
        try {
            sha = await git(vault, ['rev-parse', 'HEAD']);
        }
        catch {
            throw new PkoError('PKO_NO_COMMITS', '仓库还没有任何提交，无法创建还原点');
        }
    }
    const id = checkpointId(now);
    await git(vault, ['update-ref', `${REF_PREFIX}/${id}`, sha]);
    return { id, sha };
}
/**
 * 列出全部还原点（新的在前）。
 * @param vault vault 根目录
 * @returns 还原点列表
 */
export async function listCheckpoints(vault) {
    if (!await isGitRepo(vault))
        return [];
    const output = await git(vault, ['for-each-ref', '--format=%(refname)%00%(objectname)', REF_PREFIX]);
    if (output === '')
        return [];
    return output.split('\n').map((line) => {
        const [ref = '', sha = ''] = line.split('\u0000');
        return { id: ref.slice(`${REF_PREFIX}/`.length), sha };
    }).sort((a, b) => b.id.localeCompare(a.id));
}
/**
 * 把一个还原点恢复进工作区。
 *
 * 只覆盖还原点里存在的文件；之后新增的文件不会因此消失——删除需要显式操作。
 *
 * @param vault vault 根目录
 * @param id 还原点 id
 * @throws PkoError 还原点不存在或 git 操作失败
 */
export async function restoreCheckpoint(vault, id) {
    const found = (await listCheckpoints(vault)).find((checkpoint) => checkpoint.id === id);
    if (found === undefined)
        throw new PkoError('PKO_NO_CHECKPOINT', `找不到还原点 ${id}`);
    try {
        await git(vault, ['checkout', found.sha, '--', '.']);
    }
    catch (error) {
        throw new PkoError('PKO_RESTORE_FAILED', `恢复失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return { sha: found.sha };
}
