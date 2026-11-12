/** 源材料增量追踪：contentHash → 产出的页面。 */
import { atomicWrite, readIfExists } from './store.ts'
import { ManifestTooNewError } from './errors.ts'

/** 本进程支持的 manifest 版本。 */
export const MANIFEST_VERSION = 1

export interface ManifestEntry {
  readonly hash: string
  readonly pages: readonly string[]
  readonly lastIngested: string
  readonly producedBy: string
}

export interface Manifest {
  readonly version: number
  readonly sources: Readonly<Record<string, ManifestEntry>>
}

/**
 * 空 manifest。
 * @returns 版本 1、无来源的 manifest
 */
export function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, sources: {} }
}

/**
 * 读取 manifest；不存在返回空。
 * @param file manifest 文件路径
 * @returns manifest
 * @throws ManifestTooNewError 文件版本高于本进程支持
 */
export async function readManifest(file: string): Promise<Manifest> {
  const raw = await readIfExists(file)
  if (raw === undefined || raw.trim() === '') return emptyManifest()
  const parsed = JSON.parse(raw) as Manifest
  const version = Number(parsed.version)
  if (Number.isFinite(version) && version > MANIFEST_VERSION) {
    throw new ManifestTooNewError(version, MANIFEST_VERSION)
  }
  return { version: Number.isFinite(version) ? version : MANIFEST_VERSION, sources: parsed.sources ?? {} }
}

/**
 * 合并一条来源记录（返回新对象，不就地修改）。
 * @param manifest 原 manifest
 * @param sourceKey 来源键（URL / 路径 / session id）
 * @param entry 记录
 * @returns 新 manifest
 */
export function mergeManifest(manifest: Manifest, sourceKey: string, entry: ManifestEntry): Manifest {
  return { version: manifest.version, sources: { ...manifest.sources, [sourceKey]: entry } }
}

/**
 * 原子写 manifest。
 * @param file manifest 文件路径
 * @param manifest 要写入的 manifest
 */
export async function writeManifest(file: string, manifest: Manifest): Promise<void> {
  await atomicWrite(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
