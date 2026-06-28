import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { installBuiltinSkills, type BuiltinSkillSource } from '../src/main/builtin-skill-installer'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-skill-test-'))
  tempDirs.push(dir)
  return dir
}

async function createSkill(sourceRoot: string, id: string): Promise<void> {
  await mkdir(join(sourceRoot, id, 'scripts'), { recursive: true })
  await writeFile(join(sourceRoot, id, 'SKILL.md'), `# ${id}\n`, 'utf8')
  await writeFile(join(sourceRoot, id, 'scripts', 'run.sh'), 'echo ok\n', 'utf8')
}

const skill = (): BuiltinSkillSource => ({
  id: 'example-skill',
  requiredPaths: ['SKILL.md', 'scripts/run.sh'],
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('installBuiltinSkills', () => {
  it('copies the complete skill directory into the global target', async () => {
    const root = await createTempDir()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await createSkill(sourceRoot, 'example-skill')

    const result = await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })

    expect(result.installed).toEqual(['example-skill'])
    expect(await readFile(join(targetRoot, 'example-skill', 'scripts', 'run.sh'), 'utf8')).toBe('echo ok\n')
  })

  it('automatically updates a valid installation when source content changes', async () => {
    const root = await createTempDir()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await createSkill(sourceRoot, 'example-skill')
    await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })
    const unchanged = await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })
    await writeFile(join(sourceRoot, 'example-skill', 'scripts', 'run.sh'), 'echo updated\n', 'utf8')

    const updated = await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })

    expect(unchanged.unchanged).toEqual(['example-skill'])
    expect(updated.installed).toEqual(['example-skill'])
    expect(await readFile(join(targetRoot, 'example-skill', 'scripts', 'run.sh'), 'utf8')).toBe('echo updated\n')
  })

  it('repairs a missing installed resource even when the version is unchanged', async () => {
    const root = await createTempDir()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await createSkill(sourceRoot, 'example-skill')
    await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })
    await rm(join(targetRoot, 'example-skill', 'scripts', 'run.sh'))

    const result = await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })

    expect(result.installed).toEqual(['example-skill'])
    expect((await stat(join(targetRoot, 'example-skill', 'scripts', 'run.sh'))).isFile()).toBe(true)
  })

  it('rejects an incomplete packaged skill before replacing the installed copy', async () => {
    const root = await createTempDir()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await createSkill(sourceRoot, 'example-skill')
    await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })
    await rm(join(sourceRoot, 'example-skill', 'scripts', 'run.sh'))

    await expect(installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] }))
      .rejects.toThrow('Built-in skill resource is missing')
    expect(await readFile(join(targetRoot, 'example-skill', 'scripts', 'run.sh'), 'utf8')).toBe('echo ok\n')
  })

  it('removes only skills previously managed as built-ins', async () => {
    const root = await createTempDir()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await createSkill(sourceRoot, 'example-skill')
    await mkdir(join(targetRoot, 'community-skill'), { recursive: true })
    await writeFile(join(targetRoot, 'community-skill', 'SKILL.md'), '# community\n', 'utf8')
    await installBuiltinSkills({ sourceRoot, targetRoot, skills: [skill()] })

    const result = await installBuiltinSkills({ sourceRoot, targetRoot, skills: [] })

    expect(result.removed).toEqual(['example-skill'])
    expect(await readFile(join(targetRoot, 'community-skill', 'SKILL.md'), 'utf8')).toBe('# community\n')
  })
})
