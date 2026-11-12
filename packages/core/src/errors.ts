/**
 * 引擎的结构化错误。调用方按 code 分支，不靠字符串匹配。
 *
 * 注意：这里刻意不用 TypeScript 的参数属性（`constructor(readonly x: string)`）——
 * Node 的类型擦除只接受可擦除语法，参数属性会在 import 时抛
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。字段一律显式声明并赋值。
 */

/** 所有引擎错误的基类。 */
export class PkoError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PkoError'
    this.code = code
  }
}

/** 乐观并发控制失败：文件在读取之后被别人改过。 */
export class ConflictError extends PkoError {
  readonly path: string
  readonly expected: string | undefined
  readonly actual: string | undefined

  constructor(path: string, expected: string | undefined, actual: string | undefined) {
    super(
      'PKO_CONFLICT',
      `写入冲突：${path} 已被其他进程修改（期望 ${expected ?? '新建'}，实际 ${actual ?? '不存在'}）。请重新读取后再写。`,
    )
    this.name = 'ConflictError'
    this.path = path
    this.expected = expected
    this.actual = actual
  }
}

/** 等待锁超时。 */
export class LockTimeoutError extends PkoError {
  readonly lockPath: string
  readonly waitMs: number

  constructor(lockPath: string, waitMs: number) {
    super('PKO_LOCK_TIMEOUT', `获取锁超时（${waitMs}ms）：${lockPath}。可能有另一个进程正在写这个 vault。`)
    this.name = 'LockTimeoutError'
    this.lockPath = lockPath
    this.waitMs = waitMs
  }
}

/** manifest 由更新的核心写入，本进程只读。 */
export class ManifestTooNewError extends PkoError {
  readonly found: number
  readonly supported: number

  constructor(found: number, supported: number) {
    super('PKO_MANIFEST_TOO_NEW', `manifest 版本 ${found} 高于本进程支持的 ${supported}，已切换到只读。`)
    this.name = 'ManifestTooNewError'
    this.found = found
    this.supported = supported
  }
}
