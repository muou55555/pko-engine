/** 引擎的结构化错误。调用方按 code 分支，不靠字符串匹配。 */

/** 所有引擎错误的基类。 */
export class PkoError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PkoError'
  }
}

/** 乐观并发控制失败：文件在读取之后被别人改过。 */
export class ConflictError extends PkoError {
  constructor(
    readonly path: string,
    readonly expected: string | undefined,
    readonly actual: string | undefined,
  ) {
    super(
      'PKO_CONFLICT',
      `写入冲突：${path} 已被其他进程修改（期望 ${expected ?? '新建'}，实际 ${actual ?? '不存在'}）。请重新读取后再写。`,
    )
    this.name = 'ConflictError'
  }
}

/** 等待锁超时。 */
export class LockTimeoutError extends PkoError {
  constructor(readonly lockPath: string, readonly waitMs: number) {
    super('PKO_LOCK_TIMEOUT', `获取锁超时（${waitMs}ms）：${lockPath}。可能有另一个进程正在写这个 vault。`)
    this.name = 'LockTimeoutError'
  }
}

/** manifest 由更新的核心写入，本进程只读。 */
export class ManifestTooNewError extends PkoError {
  constructor(readonly found: number, readonly supported: number) {
    super('PKO_MANIFEST_TOO_NEW', `manifest 版本 ${found} 高于本进程支持的 ${supported}，已切换到只读。`)
    this.name = 'ManifestTooNewError'
  }
}
