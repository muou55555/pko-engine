#!/usr/bin/env node
/** 子进程：持有锁后等待被杀。 */
const [, , lockPath, holdMs] = process.argv
const { acquireLock } = await import('../../packages/core/src/lock.ts')
const handle = await acquireLock(lockPath)
console.log('HELD')
await new Promise((resolve) => setTimeout(resolve, Number(holdMs ?? '10000')))
await handle.release()
