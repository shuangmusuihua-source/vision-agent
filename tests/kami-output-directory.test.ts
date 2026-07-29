import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const kamiRoot = resolve('src/main/skills/kami')
const scriptsRoot = join(kamiRoot, 'scripts')
const printOutputDirectory = [
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'from shared import example_output_dir',
  'print(example_output_dir())',
].join(';')

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sumi-kami-output-test-'))
  tempDirs.push(directory)
  return directory
}

async function resolveKamiOutput(cwd: string, logicalPwd = cwd, configured?: string): Promise<string> {
  const env = {
    ...process.env,
    PWD: logicalPwd,
    PYTHONDONTWRITEBYTECODE: '1',
  }
  if (configured) env.KAMI_OUTPUT_DIR = configured
  else delete env.KAMI_OUTPUT_DIR
  const result = await execFileAsync(
    'python3',
    ['-c', printOutputDirectory, scriptsRoot],
    { cwd, env },
  )
  return result.stdout.trim()
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('Kami output directory', () => {
  it('writes build artifacts to the session working directory', async () => {
    const root = await createTempDir()
    const sessionRoot = join(root, 'workspace', '.sumi', 'sessions', 'session-a')
    await mkdir(sessionRoot, { recursive: true })

    await expect(resolveKamiOutput(sessionRoot))
      .resolves.toBe(join(await realpath(sessionRoot), 'kami-output'))
  })

  it('recovers the session root after entering Kami through its Skill symlink', async () => {
    const root = await createTempDir()
    const sessionRoot = join(root, 'workspace', '.sumi', 'sessions', 'session-a')
    const linkPath = join(sessionRoot, '.claude', 'skills', 'kami')
    await mkdir(join(sessionRoot, '.claude', 'skills'), { recursive: true })
    await symlink(kamiRoot, linkPath, 'dir')

    await expect(resolveKamiOutput(linkPath, linkPath))
      .resolves.toBe(join(await realpath(sessionRoot), 'kami-output'))
  })

  it('rejects output paths inside the installed Skill', async () => {
    await expect(resolveKamiOutput(kamiRoot)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Kami output directory must be outside installed Skill resources',
      ),
    })
  })

  it('allows an explicit output directory outside the installed Skill', async () => {
    const root = await createTempDir()
    const outputDirectory = join(root, 'custom-output')

    await expect(resolveKamiOutput(kamiRoot, kamiRoot, outputDirectory))
      .resolves.toBe(join(await realpath(root), 'custom-output'))
  })
})
