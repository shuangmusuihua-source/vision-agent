import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DingTalkCliRuntimeManager,
  getDingTalkCliAgentExecutablePath,
  getDingTalkCliExecutablePath,
  type DingTalkCliReleaseAsset,
} from '../src/main/dingtalk-runtime'
import { filterDingTalkSkillByConnectorReadiness } from '../src/main/dingtalk-connection'
import { DINGTALK_CLI_VERSION } from '../src/shared/dingtalk-types'

const temporaryDirectories: string[] = []

async function temporaryRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sumi-dingtalk-runtime-'))
  temporaryDirectories.push(root)
  return root
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function testAsset(archive: Buffer, binary: Buffer): DingTalkCliReleaseAsset {
  return {
    archiveName: `dws-${DINGTALK_CLI_VERSION}-test.tar.gz`,
    archiveSize: archive.byteLength,
    archiveSha256: sha256(archive),
    binarySize: binary.byteLength,
    binarySha256: sha256(binary),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DingTalk CLI managed runtime', () => {
  it('exposes the DingTalk Skill only while the connector is connected', async () => {
    const skillIds = ['kami', 'dingtalk']

    await expect(filterDingTalkSkillByConnectorReadiness(skillIds, {
      getStatus: async () => ({
        phase: 'unauthorized',
        runtime: { state: 'ready', version: DINGTALK_CLI_VERSION, executablePath: '/runtime/dws' },
      }),
    })).resolves.toEqual(['kami'])

    await expect(filterDingTalkSkillByConnectorReadiness(skillIds, {
      getStatus: async () => ({
        phase: 'connected',
        runtime: { state: 'ready', version: DINGTALK_CLI_VERSION, executablePath: '/runtime/dws' },
        identity: { userName: 'User', corpName: 'Org' },
      }),
    })).resolves.toEqual(skillIds)


  })

  it('reports unsupported platforms without attempting a download', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const manager = new DingTalkCliRuntimeManager({
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

  it('downloads, verifies, extracts, probes, and atomically installs the pinned binary', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const archive = Buffer.from('verified-dingtalk-archive')
    const binary = Buffer.from('verified-dingtalk-binary')
    const asset = testAsset(archive, binary)
    const downloads: string[][] = []
    const manager = new DingTalkCliRuntimeManager({
      runtimeRoot,
      releaseAsset: asset,
      downloadArchive: async (urls, destinationPath, expectedSize) => {
        downloads.push(urls)
        expect(expectedSize).toBe(archive.byteLength)
        await writeFile(destinationPath, archive)
      },
      extractArchive: async (_archivePath, destinationDir) => {
        await mkdir(destinationDir, { recursive: true })
        await writeFile(join(destinationDir, 'dws'), binary)
      },
      runCommand: async () => ({ stdout: `dws version ${DINGTALK_CLI_VERSION}\n`, stderr: '' }),
    })

    const result = await manager.install()

    expect(result).toMatchObject({
      success: true,
      status: { state: 'ready', version: DINGTALK_CLI_VERSION },
    })
    expect(downloads).toEqual([[
      `https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v${DINGTALK_CLI_VERSION}/${asset.archiveName}`,
      `https://gitee.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v${DINGTALK_CLI_VERSION}/${asset.archiveName}`,
    ]])
    expect(await readFile(getDingTalkCliExecutablePath(runtimeRoot))).toEqual(binary)
    const shim = await readFile(getDingTalkCliAgentExecutablePath(runtimeRoot), 'utf8')
    expect(shim).toContain('请在 sumi 连接器中管理钉钉登录与授权')
    expect(shim).toContain('exec "$script_dir/../bin/dws" "$@"')
  })

  it('rejects an archive that does not match the pinned release checksum', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const expectedArchive = Buffer.from('expected-archive')
    const binary = Buffer.from('expected-binary')
    const manager = new DingTalkCliRuntimeManager({
      runtimeRoot,
      releaseAsset: testAsset(expectedArchive, binary),
      downloadArchive: async (_urls, destinationPath) => {
        await writeFile(destinationPath, Buffer.from('tampered-archive'))
      },
      extractArchive: async () => {
        throw new Error('extractor must not run for an invalid archive')
      },
      runCommand: async () => ({ stdout: `dws version ${DINGTALK_CLI_VERSION}\n`, stderr: '' }),
    })

    await expect(manager.install()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('校验失败'),
    })
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
  })
})
