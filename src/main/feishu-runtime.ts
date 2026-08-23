import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppUserDataDir } from './app-identity'
import { ManagedRuntimeInstallTransaction } from './managed-runtime-install'
import {
  FEISHU_CLI_VERSION,
  type FeishuRuntimeInstallResult,
  type FeishuRuntimeStatus,
} from '../shared/feishu-types'

const RELEASE_BASE_URL = `https://github.com/larksuite/cli/releases/download/v${FEISHU_CLI_VERSION}`
const RELEASE_MIRROR_BASE_URL = `https://registry.npmmirror.com/-/binary/lark-cli/v${FEISHU_CLI_VERSION}`
const PROBE_TIMEOUT_MS = 15_000

const FEISHU_AGENT_SHIM = `#!/bin/sh
command_name="\${1:-}"
subcommand_name="\${2:-}"

if [ "$command_name" = "auth" ]; then
  case "$subcommand_name" in
    status|check|scopes|list) ;;
    *)
      echo '{"ok":false,"error":{"type":"sumi_connector","message":"飞书登录与授权必须在 sumi 的连接器页面完成"}}' >&2
      exit 2
      ;;
  esac
fi

case "$command_name" in
  config|profile|api)
    echo '{"ok":false,"error":{"type":"sumi_connector","message":"该飞书 CLI 操作不向 Agent 开放，请使用 sumi 的连接器页面"}}' >&2
    exit 2
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$script_dir/../bin/lark-cli" "$@"
`

export interface FeishuCliReleaseAsset {
  archiveName: string
  archiveSize: number
  archiveSha256: string
  binarySize: number
  binarySha256: string
}

const RELEASE_ASSETS: Record<string, FeishuCliReleaseAsset> = {
  'darwin-arm64': {
    archiveName: `lark-cli-${FEISHU_CLI_VERSION}-darwin-arm64.tar.gz`,
    archiveSize: 13_426_343,
    archiveSha256: '62417d641a2a15fddec9bac0c70f939570d5e2f3fa1410703b93f3284d02d044',
    binarySize: 45_522_394,
    binarySha256: '4140261413851fe27cfdc76b42ecefc01414154884ba26d39e9c597405212955',
  },
  'darwin-x64': {
    archiveName: `lark-cli-${FEISHU_CLI_VERSION}-darwin-amd64.tar.gz`,
    archiveSize: 14_532_366,
    archiveSha256: '1991736631266a2fa852664562260a2c2665bc9b1cbee35fadb4f6e40958656f',
    binarySize: 48_390_008,
    binarySha256: 'a8b552250487edd2eae3b94b15b3f635493d2f7137bd7727f73fb2ada17a6aae',
  },
}

interface CommandResult {
  stdout: string
  stderr: string
}

export type FeishuCliCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>

export type FeishuCliArchiveDownloader = (
  urls: string[],
  destinationPath: string,
  expectedSize: number,
) => Promise<void>

export type FeishuCliArchiveExtractor = (
  archivePath: string,
  destinationDir: string,
) => Promise<void>

export interface FeishuCliRuntimeManagerOptions {
  runtimeRoot: string
  platform?: NodeJS.Platform
  arch?: string
  releaseAsset?: FeishuCliReleaseAsset | null
  runCommand?: FeishuCliCommandRunner
  downloadArchive?: FeishuCliArchiveDownloader
  extractArchive?: FeishuCliArchiveExtractor
}

export function getFeishuCliConfigDir(): string {
  return join(getAppUserDataDir(), 'connectors', 'feishu')
}

export function getFeishuCliProcessEnv(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LARKSUITE_CLI_CONFIG_DIR: getFeishuCliConfigDir(),
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  }
}

function defaultRunCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: getFeishuCliProcessEnv(),
    }, (error, stdout, stderr) => {
      if (error) {
        rejectCommand(new Error(stderr.trim() || error.message))
        return
      }
      resolveCommand({ stdout, stderr })
    })
  })
}

async function defaultDownloadArchive(
  urls: string[],
  destinationPath: string,
  expectedSize: number,
): Promise<void> {
  let lastError: unknown = new Error('没有可用的飞书 CLI 下载地址')
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': `sumi/${FEISHU_CLI_VERSION}` },
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const content = Buffer.from(await response.arrayBuffer())
      if (content.byteLength !== expectedSize) throw new Error('下载文件大小与发布清单不一致')
      await writeFile(destinationPath, content, { mode: 0o600 })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function defaultExtractArchive(archivePath: string, destinationDir: string): Promise<void> {
  return new Promise((resolveExtract, rejectExtract) => {
    execFile('/usr/bin/tar', ['-xzf', archivePath, '-C', destinationDir], {
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, _stdout, stderr) => {
      if (error) {
        rejectExtract(new Error(stderr.trim() || error.message))
        return
      }
      resolveExtract()
    })
  })
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function releaseAsset(platform: NodeJS.Platform, arch: string): FeishuCliReleaseAsset | null {
  return RELEASE_ASSETS[`${platform}-${arch}`] || null
}

export function getFeishuCliRuntimeRoot(): string {
  return join(getAppUserDataDir(), 'runtimes', 'lark-cli')
}

export function getFeishuCliBinDir(runtimeRoot = getFeishuCliRuntimeRoot()): string {
  return join(runtimeRoot, FEISHU_CLI_VERSION, 'bin')
}

export function getFeishuCliAgentBinDir(runtimeRoot = getFeishuCliRuntimeRoot()): string {
  return join(runtimeRoot, FEISHU_CLI_VERSION, 'agent-bin')
}

export function getFeishuCliExecutablePath(runtimeRoot = getFeishuCliRuntimeRoot()): string {
  return join(getFeishuCliBinDir(runtimeRoot), 'lark-cli')
}

export function getFeishuCliAgentExecutablePath(runtimeRoot = getFeishuCliRuntimeRoot()): string {
  return join(getFeishuCliAgentBinDir(runtimeRoot), 'lark-cli')
}

export class FeishuCliRuntimeManager {
  private readonly runtimeRoot: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly runCommand: FeishuCliCommandRunner
  private readonly downloadArchive: FeishuCliArchiveDownloader
  private readonly extractArchive: FeishuCliArchiveExtractor
  private readonly releaseAssetOverride: FeishuCliReleaseAsset | null | undefined
  private readonly installer: ManagedRuntimeInstallTransaction<FeishuRuntimeInstallResult>

  constructor(options: FeishuCliRuntimeManagerOptions) {
    this.runtimeRoot = options.runtimeRoot
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.runCommand = options.runCommand ?? defaultRunCommand
    this.downloadArchive = options.downloadArchive ?? defaultDownloadArchive
    this.extractArchive = options.extractArchive ?? defaultExtractArchive
    this.releaseAssetOverride = options.releaseAsset
    this.installer = new ManagedRuntimeInstallTransaction(
      join(this.runtimeRoot, FEISHU_CLI_VERSION),
    )
  }

  private asset(): FeishuCliReleaseAsset | null {
    return this.releaseAssetOverride === undefined
      ? releaseAsset(this.platform, this.arch)
      : this.releaseAssetOverride
  }

  private executablePath(): string {
    return getFeishuCliExecutablePath(this.runtimeRoot)
  }

  private async ensureAgentShim(root = join(this.runtimeRoot, FEISHU_CLI_VERSION)): Promise<void> {
    const agentBinDir = join(root, 'agent-bin')
    const shimPath = join(agentBinDir, 'lark-cli')
    await mkdir(agentBinDir, { recursive: true })
    const existing = await readFile(shimPath, 'utf8').catch(() => null)
    if (existing !== FEISHU_AGENT_SHIM) {
      await writeFile(shimPath, FEISHU_AGENT_SHIM, { encoding: 'utf8', mode: 0o755 })
    }
    await chmod(shimPath, 0o755)
  }

  private async isExecutableValid(asset: FeishuCliReleaseAsset, executablePath: string): Promise<boolean> {
    try {
      const fileStat = await stat(executablePath)
      if (!fileStat.isFile() || fileStat.size !== asset.binarySize) return false
      if (await fileSha256(executablePath) !== asset.binarySha256) return false
      const result = await this.runCommand(executablePath, ['--version'], PROBE_TIMEOUT_MS)
      return `${result.stdout}\n${result.stderr}`.includes(FEISHU_CLI_VERSION)
    } catch {
      return false
    }
  }

  async getStatus(): Promise<FeishuRuntimeStatus> {
    const asset = this.asset()
    if (!asset) return { state: 'unsupported', platform: this.platform, arch: this.arch }

    const executablePath = this.executablePath()
    try {
      await stat(executablePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          state: 'not-installed',
          version: FEISHU_CLI_VERSION,
          downloadSizeBytes: asset.archiveSize,
          reason: 'missing',
        }
      }
      throw error
    }

    if (!await this.isExecutableValid(asset, executablePath)) {
      return {
        state: 'not-installed',
        version: FEISHU_CLI_VERSION,
        downloadSizeBytes: asset.archiveSize,
        reason: 'invalid',
      }
    }

    await this.ensureAgentShim()
    return { state: 'ready', version: FEISHU_CLI_VERSION, executablePath }
  }

  install(): Promise<FeishuRuntimeInstallResult> {
    return this.installer.run({
      preflight: async () => {
        const existingStatus = await this.getStatus()
        if (existingStatus.state === 'ready') {
          return { install: false, result: { success: true, status: existingStatus } }
        }
        const asset = this.asset()
        if (!asset) {
          return {
            install: false,
            result: {
              success: false,
              error: `当前系统暂不支持飞书连接器（${this.platform}/${this.arch}）`,
            },
          }
        }
        return { install: true, context: asset }
      },
      stage: async (stagingPath, asset) => {
        const stagingBinDir = join(stagingPath, 'bin')
        const archivePath = join(stagingPath, asset.archiveName)
        const stagingExecutable = join(stagingBinDir, 'lark-cli')
        await mkdir(stagingBinDir, { recursive: true })
        await this.downloadArchive([
          `${RELEASE_BASE_URL}/${asset.archiveName}`,
          `${RELEASE_MIRROR_BASE_URL}/${asset.archiveName}`,
        ], archivePath, asset.archiveSize)

        if (await fileSha256(archivePath) !== asset.archiveSha256) {
          throw new Error('飞书 CLI 发布包校验失败，安装已取消')
        }

        await this.extractArchive(archivePath, stagingBinDir)
        await rm(archivePath, { force: true })
        const binaryStat = await stat(stagingExecutable)
        if (!binaryStat.isFile() || binaryStat.size !== asset.binarySize) {
          throw new Error('飞书 CLI 解压后的文件大小不正确')
        }
        if (await fileSha256(stagingExecutable) !== asset.binarySha256) {
          throw new Error('飞书 CLI 二进制校验失败，安装已取消')
        }

        await chmod(stagingExecutable, 0o755)
        const probe = await this.runCommand(stagingExecutable, ['--version'], PROBE_TIMEOUT_MS)
        if (!`${probe.stdout}\n${probe.stderr}`.includes(FEISHU_CLI_VERSION)) {
          throw new Error('飞书 CLI 版本检查失败')
        }
        await this.ensureAgentShim(stagingPath)
      },
      activate: async () => {
        const status = await this.getStatus()
        if (status.state !== 'ready') throw new Error('飞书 CLI 安装后未通过完整性检查')
        return { success: true, status }
      },
      failure: (error) => {
        console.error('[FeishuCLI] runtime installation failed:', error)
        const message = error instanceof Error ? error.message : '未知错误'
        return { success: false, error: `飞书连接器安装失败：${message}` }
      },
    })
  }
}

let defaultManager: FeishuCliRuntimeManager | null = null

export function getFeishuCliRuntimeManager(): FeishuCliRuntimeManager {
  if (!defaultManager) {
    defaultManager = new FeishuCliRuntimeManager({ runtimeRoot: getFeishuCliRuntimeRoot() })
  }
  return defaultManager
}
