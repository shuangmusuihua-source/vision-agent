import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkspaceSkillLinks } from '../src/main/workspace-skill-links'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-skill-link-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('ensureWorkspaceSkillLinks', () => {
  it('links workspace Skill entries to one global installation', async () => {
    const root = await createTempDir()
    const globalRoot = join(root, 'app-data', '.claude', 'skills')
    const workspaceRoot = join(root, 'workspace')
    await mkdir(join(globalRoot, 'slides'), { recursive: true })
    await writeFile(join(globalRoot, 'slides', 'SKILL.md'), '# slides\n', 'utf8')

    const result = await ensureWorkspaceSkillLinks({
      globalSkillsRoot: globalRoot,
      workspaceRoot,
      skillIds: ['slides'],
    })

    const linkPath = join(workspaceRoot, '.claude', 'skills', 'slides')
    expect(result.linked).toEqual(['slides'])
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(resolve(join(linkPath, '..'), await readlink(linkPath))).toBe(resolve(globalRoot, 'slides'))
  })

  it('replaces legacy app-managed copies with links', async () => {
    const root = await createTempDir()
    const globalRoot = join(root, 'app-data', '.claude', 'skills')
    const workspaceRoot = join(root, 'workspace')
    const legacyMarker = join(workspaceRoot, '.vision', '.claude-skills-version')
    await mkdir(join(globalRoot, 'slides'), { recursive: true })
    await mkdir(join(workspaceRoot, '.claude', 'skills', 'slides'), { recursive: true })
    await mkdir(join(workspaceRoot, '.vision'), { recursive: true })
    await writeFile(join(globalRoot, 'slides', 'SKILL.md'), '# global\n', 'utf8')
    await writeFile(join(workspaceRoot, '.claude', 'skills', 'slides', 'SKILL.md'), '# legacy\n', 'utf8')
    await writeFile(legacyMarker, 'slides', 'utf8')

    await ensureWorkspaceSkillLinks({ globalSkillsRoot: globalRoot, workspaceRoot, skillIds: ['slides'], legacyMarkerPath: legacyMarker })

    expect((await lstat(join(workspaceRoot, '.claude', 'skills', 'slides'))).isSymbolicLink()).toBe(true)
    await expect(lstat(legacyMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves unmanaged workspace Skill directories', async () => {
    const root = await createTempDir()
    const globalRoot = join(root, 'app-data', '.claude', 'skills')
    const workspaceRoot = join(root, 'workspace')
    await mkdir(join(globalRoot, 'slides'), { recursive: true })
    await mkdir(join(workspaceRoot, '.claude', 'skills', 'slides'), { recursive: true })
    await writeFile(join(workspaceRoot, '.claude', 'skills', 'slides', 'SKILL.md'), '# custom\n', 'utf8')

    const result = await ensureWorkspaceSkillLinks({ globalSkillsRoot: globalRoot, workspaceRoot, skillIds: ['slides'] })

    expect(result.conflicts).toEqual(['slides'])
    expect(await readFile(join(workspaceRoot, '.claude', 'skills', 'slides', 'SKILL.md'), 'utf8')).toBe('# custom\n')
  })

  it('does not link the global Skill directory into itself', async () => {
    const root = await createTempDir()
    const appDataRoot = join(root, 'app-data')
    const globalRoot = join(appDataRoot, '.claude', 'skills')
    await mkdir(join(globalRoot, 'slides'), { recursive: true })

    const result = await ensureWorkspaceSkillLinks({ globalSkillsRoot: globalRoot, workspaceRoot: appDataRoot, skillIds: ['slides'] })

    expect(result).toEqual({ linked: [], unchanged: [], conflicts: [] })
  })
})
