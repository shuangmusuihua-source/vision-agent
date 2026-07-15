import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppUserDataDir } from './app-identity'
import {
  OFFICECLI_VERSION,
  type OfficeCliRuntimeInstallResult,
  type OfficeCliRuntimeStatus,
} from '../shared/officecli-runtime'

const RELEASE_BASE_URL = `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${OFFICECLI_VERSION}`
const PROBE_TIMEOUT_MS = 15_000

export interface OfficeCliReleaseAsset {
  fileName: string
  size: number
  sha256: string
}

const RELEASE_ASSETS: Record<string, OfficeCliReleaseAsset> = {
  'darwin-arm64': {
    fileName: 'officecli-mac-arm64',
    size: 33_539_136,
    sha256: 'b8582853cc464fa0bdb2fabc2803821472c9449c38b365a7be79fcb53d6356e7',
  },
  'darwin-x64': {
    fileName: 'officecli-mac-x64',
    size: 34_477_296,
    sha256: 'f0073b16a5181837d0b0df3e264a338066b02f4ac16f4758538873fbc32bf9b2',
  },
}

interface CommandResult {
  stdout: string
  stderr: string
}

export type OfficeCliCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>

export type OfficeCliDownloader = (
  url: string,
  destinationPath: string,
  expectedSize: number,
) => Promise<void>

export interface OfficeCliRuntimeManagerOptions {
  runtimeRoot: string
  platform?: NodeJS.Platform
  arch?: string
  releaseAsset?: OfficeCliReleaseAsset | null
  runCommand?: OfficeCliCommandRunner
  download?: OfficeCliDownloader
}

function defaultRunCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        OFFICECLI_SKIP_UPDATE: '1',
      },
    }, (error, stdout, stderr) => {
      if (error) {
        rejectCommand(new Error(stderr.trim() || error.message))
        return
      }
      resolveCommand({ stdout, stderr })
    })
  })
}

async function defaultDownload(
  url: string,
  destinationPath: string,
  expectedSize: number,
): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': `sumi/${OFFICECLI_VERSION}` },
  })
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`)
  }

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > 0 && declaredSize !== expectedSize) {
    throw new Error('下载文件大小与发布清单不一致')
  }

  const content = Buffer.from(await response.arrayBuffer())
  if (content.byteLength !== expectedSize) {
    throw new Error('下载文件不完整')
  }
  await writeFile(destinationPath, content, { mode: 0o755 })
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function releaseAsset(platform: NodeJS.Platform, arch: string): OfficeCliReleaseAsset | null {
  return RELEASE_ASSETS[`${platform}-${arch}`] || null
}

export function getOfficeCliRuntimeRoot(): string {
  return join(getAppUserDataDir(), 'runtimes', 'officecli')
}

export function getOfficeCliBinDir(runtimeRoot = getOfficeCliRuntimeRoot()): string {
  return join(runtimeRoot, OFFICECLI_VERSION, 'bin')
}

export function getOfficeCliExecutablePath(runtimeRoot = getOfficeCliRuntimeRoot()): string {
  return join(getOfficeCliBinDir(runtimeRoot), 'officecli')
}

export class OfficeCliRuntimeManager {
  private readonly runtimeRoot: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly runCommand: OfficeCliCommandRunner
  private readonly download: OfficeCliDownloader
  private readonly releaseAssetOverride: OfficeCliReleaseAsset | null | undefined
  private installPromise: Promise<OfficeCliRuntimeInstallResult> | null = null

  constructor(options: OfficeCliRuntimeManagerOptions) {
    this.runtimeRoot = options.runtimeRoot
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.runCommand = options.runCommand ?? defaultRunCommand
    this.download = options.download ?? defaultDownload
    this.releaseAssetOverride = options.releaseAsset
  }

  private asset(): OfficeCliReleaseAsset | null {
    return this.releaseAssetOverride === undefined
      ? releaseAsset(this.platform, this.arch)
      : this.releaseAssetOverride
  }

  private executablePath(): string {
    return getOfficeCliExecutablePath(this.runtimeRoot)
  }

  private async isExecutableValid(asset: OfficeCliReleaseAsset, executablePath: string): Promise<boolean> {
    try {
      const fileStat = await stat(executablePath)
      if (!fileStat.isFile() || fileStat.size !== asset.size) return false
      if (await fileSha256(executablePath) !== asset.sha256) return false
      const result = await this.runCommand(executablePath, ['--version'], PROBE_TIMEOUT_MS)
      return `${result.stdout}\n${result.stderr}`.includes(OFFICECLI_VERSION)
    } catch {
      return false
    }
  }

  async getStatus(): Promise<OfficeCliRuntimeStatus> {
    const asset = this.asset()
    if (!asset) {
      return { state: 'unsupported', platform: this.platform, arch: this.arch }
    }

    const executablePath = this.executablePath()
    try {
      await stat(executablePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          state: 'not-installed',
          version: OFFICECLI_VERSION,
          downloadSizeBytes: asset.size,
          reason: 'missing',
        }
      }
      throw error
    }

    if (!await this.isExecutableValid(asset, executablePath)) {
      return {
        state: 'not-installed',
        version: OFFICECLI_VERSION,
        downloadSizeBytes: asset.size,
        reason: 'invalid',
      }
    }

    return { state: 'ready', version: OFFICECLI_VERSION, executablePath }
  }

  install(): Promise<OfficeCliRuntimeInstallResult> {
    if (!this.installPromise) {
      this.installPromise = this.performInstall().finally(() => {
        this.installPromise = null
      })
    }
    return this.installPromise
  }

  private async performInstall(): Promise<OfficeCliRuntimeInstallResult> {
    const existingStatus = await this.getStatus()
    if (existingStatus.state === 'ready') return { success: true, status: existingStatus }

    const asset = this.asset()
    if (!asset) {
      return { success: false, error: `当前系统暂不支持 Office 文档能力（${this.platform}/${this.arch}）` }
    }

    await mkdir(this.runtimeRoot, { recursive: true })
    const stagingRoot = join(this.runtimeRoot, `.install-${randomUUID()}`)
    const stagingBinDir = join(stagingRoot, 'bin')
    const stagingExecutable = join(stagingBinDir, 'officecli')
    const targetRoot = join(this.runtimeRoot, OFFICECLI_VERSION)

    try {
      await mkdir(stagingBinDir, { recursive: true })
      await this.download(`${RELEASE_BASE_URL}/${asset.fileName}`, stagingExecutable, asset.size)

      if (await fileSha256(stagingExecutable) !== asset.sha256) {
        throw new Error('OfficeCLI 校验失败，安装已取消')
      }

      await chmod(stagingExecutable, 0o755)
      const probe = await this.runCommand(stagingExecutable, ['--version'], PROBE_TIMEOUT_MS)
      if (!`${probe.stdout}\n${probe.stderr}`.includes(OFFICECLI_VERSION)) {
        throw new Error('OfficeCLI 版本检查失败')
      }

      await rm(targetRoot, { recursive: true, force: true })
      await rename(stagingRoot, targetRoot)

      const status = await this.getStatus()
      if (status.state !== 'ready') throw new Error('OfficeCLI 安装后未通过完整性检查')
      return { success: true, status }
    } catch (error) {
      console.error('[OfficeCLI] runtime installation failed:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: `Office 文档能力安装失败：${message}` }
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

let defaultManager: OfficeCliRuntimeManager | null = null

export function getOfficeCliRuntimeManager(): OfficeCliRuntimeManager {
  if (!defaultManager) {
    defaultManager = new OfficeCliRuntimeManager({ runtimeRoot: getOfficeCliRuntimeRoot() })
  }
  return defaultManager
}
