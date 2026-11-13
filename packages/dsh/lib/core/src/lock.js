/**
 * 跨进程单写者锁。
 *
 * 为什么需要它：Claude Code 和 DSH 是两个进程，可能同时写同一个 vault。
 * `tmp + rename` 只能保证"不出现半截文件"，保证不了"不丢更新"。
 * 锁把同一 vault 的写操作串行化，配合乐观版本校验实现"冲突显式报错、不静默覆盖"。
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { LockTimeoutError } from "./errors.js";
const RETRY_MS = 40;
/** 判断一个错误是不是"锁文件已存在"。 */
function isExists(error) {
    return error?.code === 'EEXIST';
}
/** 判断进程是否仍存活（EPERM 表示存在但无权限，也算存活）。 */
function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
/** 可中断的等待。 */
async function sleep(ms) {
    await new Promise((resolve) => { setTimeout(resolve, ms); });
}
/**
 * 尝试接管一个陈旧的锁。
 * @param lockPath 锁文件路径
 * @param ttlMs 锁的存活上限
 * @returns 是否已删除陈旧锁（true 表示可以重试获取）
 */
async function breakIfStale(lockPath, ttlMs) {
    let raw;
    try {
        raw = await readFile(lockPath, 'utf8');
    }
    catch {
        return false;
    }
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        payload = undefined;
    }
    const stale = payload === undefined
        || !Number.isFinite(payload.ts)
        || Date.now() - payload.ts > ttlMs;
    if (!stale)
        return false;
    // 同主机且持有者仍活着：不抢，等它自己释放
    if (payload !== undefined && payload.host === hostname() && isAlive(payload.pid))
        return false;
    await rm(lockPath, { force: true });
    return true;
}
/**
 * 获取 vault 的写锁。
 * @param lockPath 锁文件路径
 * @param options.ttlMs 锁存活上限，默认 30 秒
 * @param options.waitMs 最长等待时间，默认 5 秒
 * @returns 锁句柄；用完必须 release
 * @throws LockTimeoutError 等待超时
 */
export async function acquireLock(lockPath, options = {}) {
    const ttlMs = options.ttlMs ?? 30_000;
    const waitMs = options.waitMs ?? 5_000;
    const token = randomBytes(8).toString('hex');
    const payload = { pid: process.pid, host: hostname(), ts: Date.now(), token };
    await mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + waitMs;
    for (;;) {
        try {
            const handle = await open(lockPath, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
            }
            finally {
                await handle.close();
            }
            return {
                token,
                release: async () => {
                    try {
                        const current = JSON.parse(await readFile(lockPath, 'utf8'));
                        if (current.token === token)
                            await rm(lockPath, { force: true });
                    }
                    catch {
                        // 锁已被别人接管或删除：释放是尽力而为，不抛错
                    }
                },
            };
        }
        catch (error) {
            if (!isExists(error))
                throw error;
        }
        if (await breakIfStale(lockPath, ttlMs))
            continue;
        if (Date.now() > deadline)
            throw new LockTimeoutError(lockPath, waitMs);
        await sleep(RETRY_MS);
    }
}
