import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs'

const userData = app.getPath('userData')
const appClaudeDir = join(userData, '.claude')
const appSkillsDir = join(appClaudeDir, 'skills')

// Built-in skill directory names (must match .claude/skills/ structure)
const BUILTIN_SKILL_NAMES = ['slides']

/**
 * Copy built-in skill files to userData/.claude/skills/ on app startup.
 * This makes them discoverable by Claude Agent SDK via project source.
 */
export function initAppSkills(): void {
  mkdirSync(appSkillsDir, { recursive: true })

  // Source: the app's .claude/skills/ directory (bundled with the app)
  // In dev: points to project root .claude/skills/
  // In production: would need to be unpacked from asar or bundled separately
  const builtInSkillsRoot = getBuiltInSkillsRoot()

  for (const skillName of BUILTIN_SKILL_NAMES) {
    const srcDir = join(builtInSkillsRoot, skillName)
    const destDir = join(appSkillsDir, skillName)

    if (!existsSync(srcDir)) {
      console.warn(`[SkillInit] Built-in skill source not found: ${srcDir}`)
      continue
    }

    // Copy entire skill directory
    copyDirRecursive(srcDir, destDir)
  }

  console.log(`[SkillInit] Skills initialized at ${appSkillsDir}`)
}

function getBuiltInSkillsRoot(): string {
  // Development: use project .claude/skills/
  // Production: use app resource path (needs asar.unpacked config)
  const devPath = join(process.cwd(), '.claude', 'skills')
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
  return BUILTIN_SKILL_NAMES
}