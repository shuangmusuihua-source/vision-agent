import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { getAppUserDataDir } from './app-identity'
import { installBuiltinSkills, type InstallBuiltinSkillsResult } from './builtin-skill-installer'
import { BUILTIN_SKILLS } from './skills/skills-manifest'
import { ensureWorkspaceSkillLinks } from './workspace-skill-links'

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

/** Claude config root used by every sumi agent process. */
export function getAppClaudeConfigDir(): string {
  return appClaudeDir
}

/** Working directory for Ask sumi sessions and app-owned data. */
export function getAppSkillsCwd(): string {
  return userData
}

/** Create lightweight project-source links without duplicating Skill resources. */
export async function ensureWorkspaceSkills(workspaceCwd: string): Promise<void> {
  const result = await ensureWorkspaceSkillLinks({
    globalSkillsRoot: appSkillsDir,
    workspaceRoot: workspaceCwd,
    skillIds: getBuiltinSkillNames(),
    legacyMarkerPath: join(workspaceCwd, '.vision', '.claude-skills-version'),
  })
  if (result.conflicts.length > 0) {
    console.warn('[SkillInit] workspace Skill conflicts preserved:', result.conflicts)
  }
}

export function getBuiltinSkillNames(): string[] {
  return BUILTIN_SKILLS.filter(skill => skill.hasResources).map(skill => skill.id)
}
