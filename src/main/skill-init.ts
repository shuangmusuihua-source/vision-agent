import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'fs'
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

/**
 * Ensure workspace-local skills exist at <workspace>/.claude/skills/.
 * Copies from app built-in skills dir on first open. Uses a version
 * sentinel file to skip redundant copies. Preserves user-added workspace
 * skills (files not in the built-in manifest are left untouched).
 */
export function ensureWorkspaceSkills(workspaceCwd: string): void {
  const builtInRoot = getBuiltInSkillsRoot()
  if (!existsSync(builtInRoot)) return

  const workspaceClaudeDir = join(workspaceCwd, '.claude')
  const workspaceSkillsDir = join(workspaceClaudeDir, 'skills')
  const sentinelPath = join(workspaceCwd, '.vision', '.claude-skills-version')

  // Determine source version from manifest
  const sourceVersion = BUILTIN_SKILLS.map(s => s.id).sort().join(',')

  // Check sentinel — skip if up to date
  if (existsSync(sentinelPath)) {
    try {
      const currentVersion = readFileSync(sentinelPath, 'utf-8').trim()
      if (currentVersion === sourceVersion) return
    } catch { /* sentinel corrupt, re-copy */ }
  }

  mkdirSync(workspaceSkillsDir, { recursive: true })
  mkdirSync(join(workspaceCwd, '.vision'), { recursive: true })

  // Get existing files in workspace skills dir (to preserve user-added ones)
  const existingFiles = new Set<string>()
  if (existsSync(workspaceSkillsDir)) {
    const scan = (dir: string, prefix = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relPath = prefix + entry.name
        if (entry.isDirectory()) {
          scan(join(dir, entry.name), relPath + '/')
        } else {
          existingFiles.add(relPath)
        }
      }
    }
    scan(workspaceSkillsDir)
  }

  // Copy built-in skills from source
  const copiedFiles = new Set<string>()
  for (const skill of BUILTIN_SKILLS) {
    if (!skill.hasResources) continue

    const srcDir = join(builtInRoot, skill.id)
    const destDir = join(workspaceSkillsDir, skill.id)

    if (!existsSync(srcDir)) continue

    const copyFiles = (src: string, dest: string, prefix = '') => {
      mkdirSync(dest, { recursive: true })
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name)
        const destPath = join(dest, entry.name)
        const relPath = prefix + entry.name
        if (entry.isDirectory()) {
          copyFiles(srcPath, destPath, relPath + '/')
        } else {
          copyFileSync(srcPath, destPath)
          copiedFiles.add(`${skill.id}/${relPath}`)
        }
      }
    }
    copyFiles(srcDir, destDir)
  }

  // Write sentinel
  try {
    writeFileSync(sentinelPath, sourceVersion, 'utf-8')
  } catch (e) {
    console.warn('[ensureWorkspaceSkills] failed to write sentinel:', e)
  }
}
