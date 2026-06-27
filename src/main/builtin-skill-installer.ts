import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname, join, relative, sep } from 'path'

export interface BuiltinSkillSource {
  id: string
  contentVersion: number
  requiredPaths: string[]
}

interface InstalledFile {
  path: string
  size: number
}

interface InstalledSkillState {
  contentVersion: number
  files: InstalledFile[]
}

interface BuiltinSkillInstallState {
  schemaVersion: 1
  skills: Record<string, InstalledSkillState>
}

export interface InstallBuiltinSkillsOptions {
  sourceRoot: string
  targetRoot: string
  skills: BuiltinSkillSource[]
  force?: boolean
}

export interface InstallBuiltinSkillsResult {
  installed: string[]
  removed: string[]
  unchanged: string[]
}

const STATE_FILE_NAME = '.sumi-builtin-skills.json'

function assertSafeRelativePath(value: string, label: string): void {
  if (!value || value === '.' || value === '..' || value.includes('\0')) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function collectFiles(root: string, current = root): Promise<InstalledFile[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: InstalledFile[] = []

  for (const entry of entries) {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, fullPath))
      continue
    }
    if (!entry.isFile()) continue

    const fileStat = await stat(fullPath)
    files.push({ path: relative(root, fullPath).split(sep).join('/'), size: fileStat.size })
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function readState(statePath: string): Promise<BuiltinSkillInstallState | null> {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<BuiltinSkillInstallState>
    if (parsed.schemaVersion !== 1 || !parsed.skills || typeof parsed.skills !== 'object') return null
    return parsed as BuiltinSkillInstallState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function isInstalledSkillValid(targetDir: string, state: InstalledSkillState): Promise<boolean> {
  for (const file of state.files) {
    try {
      const fileStat = await stat(join(targetDir, file.path))
      if (!fileStat.isFile() || fileStat.size !== file.size) return false
    } catch {
      return false
    }
  }
  return state.files.some(file => file.path === 'SKILL.md')
}

async function validateSource(sourceRoot: string, skill: BuiltinSkillSource): Promise<InstalledFile[]> {
  assertSafeRelativePath(skill.id, 'skill id')
  const sourceDir = join(sourceRoot, skill.id)
  if (!await pathExists(sourceDir)) {
    throw new Error(`Built-in skill source is missing: ${skill.id}`)
  }

  for (const requiredPath of skill.requiredPaths) {
    assertSafeRelativePath(requiredPath, `required path for ${skill.id}`)
    if (!await pathExists(join(sourceDir, requiredPath))) {
      throw new Error(`Built-in skill resource is missing: ${skill.id}/${requiredPath}`)
    }
  }

  const files = await collectFiles(sourceDir)
  if (!files.some(file => file.path === 'SKILL.md')) {
    throw new Error(`Built-in skill is missing SKILL.md: ${skill.id}`)
  }
  return files
}

async function replaceDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const nonce = `${process.pid}-${randomUUID()}`
  const stagingDir = `${targetDir}.staging-${nonce}`
  const backupDir = `${targetDir}.backup-${nonce}`
  let movedExistingTarget = false

  await rm(stagingDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })
  await cp(sourceDir, stagingDir, { recursive: true, force: true })

  try {
    if (await pathExists(targetDir)) {
      await rename(targetDir, backupDir)
      movedExistingTarget = true
    }
    await rename(stagingDir, targetDir)
    await rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    if (movedExistingTarget && !await pathExists(targetDir) && await pathExists(backupDir)) {
      await rename(backupDir, targetDir)
    }
    throw error
  }
}

async function writeState(statePath: string, state: BuiltinSkillInstallState): Promise<void> {
  const tempPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, statePath)
}

export async function installBuiltinSkills(options: InstallBuiltinSkillsOptions): Promise<InstallBuiltinSkillsResult> {
  const statePath = join(options.targetRoot, STATE_FILE_NAME)
  const previousState = await readState(statePath)
  const nextState: BuiltinSkillInstallState = { schemaVersion: 1, skills: {} }
  const result: InstallBuiltinSkillsResult = { installed: [], removed: [], unchanged: [] }

  await mkdir(options.targetRoot, { recursive: true })

  for (const skill of options.skills) {
    const sourceFiles = await validateSource(options.sourceRoot, skill)
    const targetDir = join(options.targetRoot, skill.id)
    const previousSkill = previousState?.skills[skill.id]
    const canReuse = !options.force
      && previousSkill?.contentVersion === skill.contentVersion
      && await isInstalledSkillValid(targetDir, previousSkill)

    if (canReuse) {
      nextState.skills[skill.id] = previousSkill
      result.unchanged.push(skill.id)
      continue
    }

    await replaceDirectory(join(options.sourceRoot, skill.id), targetDir)
    nextState.skills[skill.id] = {
      contentVersion: skill.contentVersion,
      files: sourceFiles,
    }
    result.installed.push(skill.id)
  }

  for (const previousId of Object.keys(previousState?.skills || {})) {
    if (nextState.skills[previousId]) continue
    assertSafeRelativePath(previousId, 'previous skill id')
    await rm(join(options.targetRoot, previousId), { recursive: true, force: true })
    result.removed.push(previousId)
  }

  await writeState(statePath, nextState)
  return result
}
