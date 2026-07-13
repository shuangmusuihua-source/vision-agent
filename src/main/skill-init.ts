import { app } from 'electron'
import { existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { getAppUserDataDir } from './app-identity'
import { installBuiltinSkills, type InstallBuiltinSkillsResult } from './builtin-skill-installer'
import { BUILTIN_SKILLS } from './skills/skills-manifest'
import { ensureWorkspaceSkillLinks, type WorkspaceSkillLinkResult } from './workspace-skill-links'

const userData = getAppUserDataDir()
const appClaudeDir = join(userData, '.claude')
const appSkillsDir = join(appClaudeDir, 'skills')

function getBuiltInSkillsRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'skills')

  const devPath = join(process.cwd(), 'src', 'main', 'skills')
  if (existsSync(devPath)) return devPath

  return join(process.resourcesPath, 'skills')
}

/** Install curated built-in skills once into sumi's global Claude config. */
export async function initAppSkills(): Promise<InstallBuiltinSkillsResult> {
  return installBuiltinSkills({
    sourceRoot: getBuiltInSkillsRoot(),
    targetRoot: appSkillsDir,
    skills: BUILTIN_SKILLS.filter(skill => skill.hasResources),
    force: !app.isPackaged,
  })
}

export function getAppSkillsDir(): string {
  return appSkillsDir
}

/** Working directory for Ask sumi sessions and app-owned data. */
export function getAppSkillsCwd(): string {
  return userData
}

/** Create lightweight project-source links without duplicating Skill resources. */
export async function ensureWorkspaceSkills(workspaceCwd: string): Promise<WorkspaceSkillLinkResult> {
  const result = await ensureWorkspaceSkillLinks({
    globalSkillsRoot: appSkillsDir,
    workspaceRoot: workspaceCwd,
    skillIds: await getInstalledSkillNames(),
  })
  if (result.conflicts.length > 0) {
    console.warn('[SkillInit] workspace Skill conflicts preserved:', result.conflicts)
  }
  return result
}

export async function getInstalledSkillNames(): Promise<string[]> {
  let entries
  try {
    entries = await readdir(appSkillsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const installed: string[] = []
  for (const entry of entries) {
    if (
      entry.name.startsWith('.')
      || entry.name.includes('.staging-')
      || entry.name.includes('.backup-')
      || !entry.isDirectory()
    ) continue
    try {
      const skillFile = await stat(join(appSkillsDir, entry.name, 'SKILL.md'))
      if (skillFile.isFile()) installed.push(entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return installed.sort((a, b) => a.localeCompare(b))
}
