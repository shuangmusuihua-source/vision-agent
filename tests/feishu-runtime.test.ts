import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FeishuCliRuntimeManager,
  getFeishuCliAgentExecutablePath,
  getFeishuCliExecutablePath,
  type FeishuCliReleaseAsset,
} from '../src/main/feishu-runtime'
import { filterFeishuSkillByConnectorReadiness } from '../src/main/feishu-connection'
import { FEISHU_CLI_VERSION } from '../src/shared/feishu-types'

const temporaryDirectories: string[] = []

async function temporaryRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sumi-feishu-runtime-'))
  temporaryDirectories.push(root)
  return root
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function testAsset(archive: Buffer, binary: Buffer): FeishuCliReleaseAsset {
  return {
    archiveName: `lark-cli-${FEISHU_CLI_VERSION}-test.tar.gz`,
    archiveSize: archive.byteLength,
    archiveSha256: sha256(archive),
    binarySize: binary.byteLength,
    binarySha256: sha256(binary),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Feishu CLI managed runtime', () => {
  it('exposes the Feishu Skill only while the connector is connected', async () => {
    const skillIds = ['kami', 'feishu']

    await expect(filterFeishuSkillByConnectorReadiness(skillIds, {
      getStatus: async () => ({
        phase: 'unauthorized',
        runtime: { state: 'ready', version: FEISHU_CLI_VERSION, executablePath: '/runtime/lark-cli' },
      }),
    })).resolves.toEqual(['kami'])

    await expect(filterFeishuSkillByConnectorReadiness(skillIds, {
      getStatus: async () => ({
        phase: 'connected',
        runtime: { state: 'ready', version: FEISHU_CLI_VERSION, executablePath: '/runtime/lark-cli' },
        identity: { userAvailable: true, botAvailable: false },
      }),
    })).resolves.toEqual(skillIds)

    await expect(filterFeishuSkillByConnectorReadiness(skillIds, {
      getStatus: async () => ({
        phase: 'bot-only',
        runtime: { state: 'ready', version: FEISHU_CLI_VERSION, executablePath: '/runtime/lark-cli' },
        identity: { userAvailable: false, botAvailable: true },
      }),
    })).resolves.toEqual(skillIds)
  })

  it('reports unsupported platforms without attempting a download', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const manager = new FeishuCliRuntimeManager({
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
    const archive = Buffer.from('verified-feishu-archive')
    const binary = Buffer.from('verified-feishu-binary')
    const asset = testAsset(archive, binary)
    const downloads: string[][] = []
    const manager = new FeishuCliRuntimeManager({
      runtimeRoot,
      releaseAsset: asset,
      downloadArchive: async (urls, destinationPath, expectedSize) => {
        downloads.push(urls)
        expect(expectedSize).toBe(archive.byteLength)
        await writeFile(destinationPath, archive)
      },
      extractArchive: async (_archivePath, destinationDir) => {
        await mkdir(destinationDir, { recursive: true })
        await writeFile(join(destinationDir, 'lark-cli'), binary)
      },
      runCommand: async () => ({ stdout: `lark-cli version ${FEISHU_CLI_VERSION}\n`, stderr: '' }),
    })

    const result = await manager.install()

    expect(result).toMatchObject({
      success: true,
      status: { state: 'ready', version: FEISHU_CLI_VERSION },
    })
    expect(downloads).toEqual([[
      `https://github.com/larksuite/cli/releases/download/v${FEISHU_CLI_VERSION}/${asset.archiveName}`,
      `https://registry.npmmirror.com/-/binary/lark-cli/v${FEISHU_CLI_VERSION}/${asset.archiveName}`,
    ]])
    expect(await readFile(getFeishuCliExecutablePath(runtimeRoot))).toEqual(binary)
    const shim = await readFile(getFeishuCliAgentExecutablePath(runtimeRoot), 'utf8')
    expect(shim).toContain('飞书登录与授权必须在 sumi 的连接器页面完成')
    expect(shim).toContain('exec "$script_dir/../bin/lark-cli" "$@"')
  })

  it('rejects an archive that does not match the pinned release checksum', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const expectedArchive = Buffer.from('expected-archive')
    const binary = Buffer.from('expected-binary')
    const manager = new FeishuCliRuntimeManager({
      runtimeRoot,
      releaseAsset: testAsset(expectedArchive, binary),
      downloadArchive: async (_urls, destinationPath) => {
        await writeFile(destinationPath, Buffer.from('tampered-archive'))
      },
      extractArchive: async () => {
        throw new Error('extractor must not run for an invalid archive')
      },
      runCommand: async () => ({ stdout: `lark-cli version ${FEISHU_CLI_VERSION}\n`, stderr: '' }),
    })

    await expect(manager.install()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('校验失败'),
    })
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
  })
})
