/** 文件读写：原子写与容错。 */
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Windows 上 rename 覆盖被占用文件时的瞬时错误码。 */
const RETRYABLE_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** 可中断的等待。 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

/** 带退避重试的 rename。 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let delay = 20
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!RETRYABLE_RENAME.has(code) || attempt >= 5) throw error
      await sleep(delay)
      delay *= 2
    }
  }
}

/**
 * 原子写：同目录临时文件 + rename。
 *
 * 同目录是必须的——跨目录 rename 在多数平台上不是原子操作。
 *
 * @param path 目标文件绝对路径
 * @param content 完整内容
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(path)}.tmp-${randomBytes(6).toString('hex')}`)
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    // fsync 失败不致命：数据仍会落盘，只是掉电一致性弱一点
    await handle.sync().catch(() => undefined)
  } finally {
    await handle.close()
  }
  try {
    await renameWithRetry(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/**
 * 读取文件；不存在返回 undefined。
 * @param path 文件绝对路径
 * @returns 文件内容或 undefined
 */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
