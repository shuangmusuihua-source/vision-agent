import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs'
import { BUILTIN_SKILLS } from './skills/skills-manifest'

const userData = app.getPath('userData')
const appClaudeDir = join(userData, '.claude')
const appSkillsDir = join(appClaudeDir, 'skills')

/**
 * Copy built-in skill files to userData/.claude/skills/ on app startup.
 * This makes them discoverable by Claude Agent SDK via project source.
 */
export function initAppSkills(): void {
  mkdirSync(appSkillsDir, { recursive: true })

  const builtInSkillsRoot = getBuiltInSkillsRoot()

  for (const skill of BUILTIN_SKILLS) {
    if (!skill.hasResources) continue

    const srcDir = join(builtInSkillsRoot, skill.id)
    const destDir = join(appSkillsDir, skill.id)

    if (!existsSync(srcDir)) {
      console.warn(`[SkillInit] Built-in skill source not found: ${srcDir}`)
      continue
    }

    copyDirRecursive(srcDir, destDir)
  }
}

function getBuiltInSkillsRoot(): string {
  // Development: use project src/main/skills/
  const devPath = join(process.cwd(), 'src', 'main', 'skills')
  if (existsSync(devPath)) return devPath

  // Production fallback: app resources
  const prodPath = join(process.resourcesPath, 'skills')
  if (existsSync(prodPath)) return prodPath

  console.warn('[SkillInit] No built-in skills root found')
  return devPath
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Get the cwd for SDK sessions that should include app skills.
 * Points to userData so .claude/skills/ is discoverable via project source.
 */
export function getAppSkillsCwd(): string {
  return userData
}

/**
 * Get the list of built-in skill names for the SDK skills whitelist.
 */
export function getBuiltinSkillNames(): string[] {
  return BUILTIN_SKILLS.filter(s => s.hasResources).map(s => s.id)
}
