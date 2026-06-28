import { lstat, mkdir, readdir, readlink, rm, symlink } from 'fs/promises'
import { join, relative, resolve } from 'path'

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

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

async function removeStaleManagedLinks(
  workspaceSkillsRoot: string,
  globalSkillsRoot: string,
  desiredSkillIds: Set<string>,
): Promise<void> {
  const entries = await readdir(workspaceSkillsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || desiredSkillIds.has(entry.name)) continue
    const linkPath = join(workspaceSkillsRoot, entry.name)
    const currentTarget = resolve(workspaceSkillsRoot, await readlink(linkPath))
    if (isInside(globalSkillsRoot, currentTarget)) {
      await rm(linkPath, { force: true })
    }
  }
}

export async function ensureWorkspaceSkillLinks(options: WorkspaceSkillLinkOptions): Promise<WorkspaceSkillLinkResult> {
  const result: WorkspaceSkillLinkResult = { linked: [], unchanged: [], conflicts: [] }
  if (resolve(options.workspaceRoot) === resolve(join(options.globalSkillsRoot, '..', '..'))) return result

  const workspaceSkillsRoot = join(options.workspaceRoot, '.claude', 'skills')
  const canReplaceLegacyCopies = await hasLegacyMarker(options.legacyMarkerPath)
  await mkdir(workspaceSkillsRoot, { recursive: true })
  const desiredSkillIds = new Set(options.skillIds)
  await removeStaleManagedLinks(workspaceSkillsRoot, options.globalSkillsRoot, desiredSkillIds)

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
