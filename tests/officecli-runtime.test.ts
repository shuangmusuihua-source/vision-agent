import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OfficeCliRuntimeManager,
  getOfficeCliExecutablePath,
  type OfficeCliReleaseAsset,
} from '../src/main/officecli-runtime'
import { OFFICECLI_VERSION } from '../src/shared/officecli-runtime'

const temporaryDirectories: string[] = []

async function temporaryRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sumi-officecli-runtime-'))
  temporaryDirectories.push(root)
  return root
}

function testAsset(content: Buffer): OfficeCliReleaseAsset {
  return {
    fileName: 'officecli-test',
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('OfficeCLI managed runtime', () => {
  it('reports unsupported platforms without attempting a download', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const manager = new OfficeCliRuntimeManager({
      runtimeRoot,
      platform: 'linux',
      arch: 'riscv64',
      releaseAsset: null,
    })

    await expect(manager.getStatus()).resolves.toEqual({
      state: 'unsupported',
      platform: 'linux',
      arch: 'riscv64',
    })
  })

  it('reports a missing runtime with the pinned version and download size', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const content = Buffer.from('officecli-binary')
    const manager = new OfficeCliRuntimeManager({
      runtimeRoot,
      releaseAsset: testAsset(content),
    })

    await expect(manager.getStatus()).resolves.toMatchObject({
      state: 'not-installed',
      version: OFFICECLI_VERSION,
      downloadSizeBytes: content.byteLength,
      reason: 'missing',
    })
  })

  it('downloads, verifies, probes, and atomically installs the pinned binary', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const content = Buffer.from('verified-officecli-binary')
    const asset = testAsset(content)
    const downloads: string[] = []
    const manager = new OfficeCliRuntimeManager({
      runtimeRoot,
      releaseAsset: asset,
      download: async (url, destinationPath) => {
        downloads.push(url)
        await writeFile(destinationPath, content)
      },
      runCommand: async () => ({ stdout: `OfficeCLI ${OFFICECLI_VERSION}\n`, stderr: '' }),
    })

    const result = await manager.install()

    expect(result).toMatchObject({
      success: true,
      status: { state: 'ready', version: OFFICECLI_VERSION },
    })
    expect(downloads).toEqual([
      `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${OFFICECLI_VERSION}/${asset.fileName}`,
    ])
    expect(await readFile(getOfficeCliExecutablePath(runtimeRoot))).toEqual(content)
  })

  it('rejects a download that does not match the release checksum', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const asset = testAsset(Buffer.from('expected'))
    const manager = new OfficeCliRuntimeManager({
      runtimeRoot,
      releaseAsset: asset,
      download: async (_url, destinationPath) => {
        await writeFile(destinationPath, Buffer.from('tampered'))
      },
      runCommand: async () => ({ stdout: `OfficeCLI ${OFFICECLI_VERSION}\n`, stderr: '' }),
    })

    await expect(manager.install()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('校验失败'),
    })
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
  })
})
