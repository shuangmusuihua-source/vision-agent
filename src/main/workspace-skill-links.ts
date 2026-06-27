import { lstat, mkdir, readlink, rm, symlink } from 'fs/promises'
import { join, resolve } from 'path'

export interface WorkspaceSkillLinkOptions {
  globalSkillsRoot: string
  workspaceRoot: string
  skillIds: string[]
  legacyMarkerPath?: string
}

export interface WorkspaceSkillLinkResult {
  linked: string[]
  unchanged: string[]
  conflicts: string[]
}

async function pathType(path: string): Promise<'missing' | 'link' | 'directory' | 'other'> {
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink()) return 'link'
    if (entry.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function hasLegacyMarker(path?: string): Promise<boolean> {
  if (!path) return false
  return await pathType(path) !== 'missing'
}

export async function ensureWorkspaceSkillLinks(options: WorkspaceSkillLinkOptions): Promise<WorkspaceSkillLinkResult> {
  const result: WorkspaceSkillLinkResult = { linked: [], unchanged: [], conflicts: [] }
  if (resolve(options.workspaceRoot) === resolve(join(options.globalSkillsRoot, '..', '..'))) return result

  const workspaceSkillsRoot = join(options.workspaceRoot, '.claude', 'skills')
  const canReplaceLegacyCopies = await hasLegacyMarker(options.legacyMarkerPath)
  await mkdir(workspaceSkillsRoot, { recursive: true })

  for (const skillId of options.skillIds) {
    const sourceDir = resolve(options.globalSkillsRoot, skillId)
    const targetDir = join(workspaceSkillsRoot, skillId)
    const targetType = await pathType(targetDir)

    if (targetType === 'link') {
      const currentTarget = resolve(workspaceSkillsRoot, await readlink(targetDir))
      if (currentTarget === sourceDir) {
        result.unchanged.push(skillId)
        continue
      }
      await rm(targetDir, { force: true })
    } else if (targetType !== 'missing') {
      if (!canReplaceLegacyCopies) {
        result.conflicts.push(skillId)
        continue
      }
      await rm(targetDir, { recursive: true, force: true })
    }

    await symlink(sourceDir, targetDir, process.platform === 'win32' ? 'junction' : 'dir')
    result.linked.push(skillId)
  }

  if (canReplaceLegacyCopies && options.legacyMarkerPath) {
    await rm(options.legacyMarkerPath, { force: true })
  }

  return result
}
