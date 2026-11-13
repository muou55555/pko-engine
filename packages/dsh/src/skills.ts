/**
 * 技能投递：插件自带一份技能，会话开始时投放到 `<vault>/.dsh/skills`。
 *
 * 规则：**只补缺，不覆盖**。用户改过的技能永远优先，插件升级不会冲掉定制。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 定位随包的技能目录：构建产物在 lib/dsh/skills，源码期回落到 packages/skills。 */
export function resolveSkillsDir(): string | undefined {
  const candidates = [
    fileURLToPath(new URL('../skills', import.meta.url)),
    fileURLToPath(new URL('../../skills', import.meta.url)),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate
    } catch {
      // 该候选不存在，继续下一个
    }
  }
  return undefined
}

export interface SkillInstallResult {
  readonly installed: readonly string[]
  readonly skipped: readonly string[]
}

/**
 * 把随包技能投放到 vault。
 * @param vault vault 根目录
 * @returns 本次新装与因已存在而跳过的技能名
 */
export function ensureSkills(vault: string): SkillInstallResult {
  const source = resolveSkillsDir()
  if (source === undefined) return { installed: [], skipped: [] }

  const targetRoot = join(vault, '.dsh', 'skills')
  const installed: string[] = []
  const skipped: string[] = []

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const from = join(source, entry.name)
    const sourceFile = join(from, 'SKILL.md')
    if (!existsSync(sourceFile)) continue
    const toDir = join(targetRoot, entry.name)
    const toFile = join(toDir, 'SKILL.md')
    if (existsSync(toFile)) {
      skipped.push(entry.name)
      continue
    }
    mkdirSync(toDir, { recursive: true })
    copyFileSync(sourceFile, toFile)
    installed.push(entry.name)
  }
  return { installed, skipped }
}
