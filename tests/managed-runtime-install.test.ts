import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagedRuntimeInstallTransaction } from '../src/main/managed-runtime-install'

const temporaryDirectories: string[] = []

async function temporaryTarget(): Promise<{ root: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sumi-runtime-transaction-'))
  temporaryDirectories.push(root)
  return { root, target: join(root, 'runtime') }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('ManagedRuntimeInstallTransaction', () => {
  it('replaces a verified runtime and removes transaction directories', async () => {
    const { root, target } = await temporaryTarget()
    await mkdir(target)
    await writeFile(join(target, 'version.txt'), 'old')
    const transaction = new ManagedRuntimeInstallTransaction<string>(target, () => 'success')

    const result = await transaction.run({
      preflight: async () => ({ install: true, context: 'new' }),
      stage: async (stagingPath, version) => {
        await mkdir(stagingPath)
        await writeFile(join(stagingPath, 'version.txt'), version)
      },
      activate: async (targetPath) => readFile(join(targetPath, 'version.txt'), 'utf8'),
      failure: (error) => {
        throw error
      },
    })

    expect(result).toBe('new')
    expect(await readFile(join(target, 'version.txt'), 'utf8')).toBe('new')
    expect((await readdir(root)).filter((name) => name.startsWith('.runtime.'))).toEqual([])
  })

  it('restores the previous runtime when final activation fails', async () => {
    const { root, target } = await temporaryTarget()
    await mkdir(target)
    await writeFile(join(target, 'version.txt'), 'old')
    const transaction = new ManagedRuntimeInstallTransaction<{ success: boolean }>(
      target,
      () => 'rollback',
    )

    const result = await transaction.run({
      preflight: async () => ({ install: true, context: undefined }),
      stage: async (stagingPath) => {
        await mkdir(stagingPath)
        await writeFile(join(stagingPath, 'version.txt'), 'invalid')
      },
      activate: async () => {
        throw new Error('final validation failed')
      },
      failure: () => ({ success: false }),
    })

    expect(result).toEqual({ success: false })
    expect(await readFile(join(target, 'version.txt'), 'utf8')).toBe('old')
    expect((await readdir(root)).filter((name) => name.startsWith('.runtime.'))).toEqual([])
  })

  it('coalesces concurrent installation calls behind one transaction', async () => {
    const { target } = await temporaryTarget()
    const transaction = new ManagedRuntimeInstallTransaction<string>(target, () => 'single')
    let stageCalls = 0
    let releaseStage: (() => void) | null = null
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve
    })
    const adapter = {
      preflight: async () => ({ install: true as const, context: 'ready' }),
      stage: async (stagingPath: string) => {
        stageCalls += 1
        await mkdir(stagingPath)
        await writeFile(join(stagingPath, 'version.txt'), 'ready')
        await stageGate
      },
      activate: async () => 'installed',
      failure: (error: unknown) => {
        throw error
      },
    }

    const first = transaction.run(adapter)
    const second = transaction.run(adapter)
    expect(first).toBe(second)
    releaseStage?.()

    await expect(first).resolves.toBe('installed')
    expect(stageCalls).toBe(1)
  })

  it('returns a completed preflight result without creating staging state', async () => {
    const { root, target } = await temporaryTarget()
    const transaction = new ManagedRuntimeInstallTransaction<string>(target, () => 'unused')

    await expect(transaction.run({
      preflight: async () => ({ install: false, result: 'already-ready' }),
      stage: async () => {
        throw new Error('stage should not run')
      },
      activate: async () => {
        throw new Error('activate should not run')
      },
      failure: (error) => {
        throw error
      },
    })).resolves.toBe('already-ready')

    expect(await readdir(root)).toEqual([])
  })
})
