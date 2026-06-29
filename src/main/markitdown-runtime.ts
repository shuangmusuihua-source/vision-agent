import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { atomicWriteTextFile } from './atomic-write'
import { getAppUserDataDir } from './app-identity'
import {
  MARKITDOWN_FORMATS,
  type MarkitdownFormat,
  type MarkitdownRuntimeInstallResult,
  type MarkitdownRuntimeStatus,
} from '../shared/markitdown-runtime'

export const MARKITDOWN_VERSION = '0.1.6'
export const MINIMUM_PYTHON_VERSION = '3.10'
export const MARKITDOWN_PACKAGE_SPEC = `markitdown[pdf,docx,pptx,xlsx]==${MARKITDOWN_VERSION}`

const PROBE_SENTINEL = '__SUMI_MARKITDOWN_RUNTIME__'
const PROBE_TIMEOUT_MS = 6_000
const INSTALL_TIMEOUT_MS = 10 * 60_000
const COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024

const FORMAT_MODULES: Record<MarkitdownFormat, string[]> = {
  pdf: ['pdfminer', 'pdfplumber'],
  docx: ['mammoth', 'lxml'],
  pptx: ['pptx'],
  xlsx: ['openpyxl', 'pandas'],
}

const PYTHON_PROBE_SCRIPT = [
  'import importlib.metadata, importlib.util, json, sys',
  'try:',
  '  markitdown_version = importlib.metadata.version("markitdown")',
  'except importlib.metadata.PackageNotFoundError:',
  '  markitdown_version = None',
  `modules = ${JSON.stringify(FORMAT_MODULES)}`,
  'supported = [name for name, required in modules.items() if markitdown_version and all(importlib.util.find_spec(module) is not None for module in required)]',
  'payload = {"executable": sys.executable, "pythonVersion": ".".join(map(str, sys.version_info[:3])), "markitdownVersion": markitdown_version, "supportedFormats": supported}',
  `print("${PROBE_SENTINEL}" + json.dumps(payload))`,
].join('\n')

interface CommandResult {
  stdout: string
  stderr: string
}

export type MarkitdownCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<CommandResult>

interface PythonProbe {
  executable: string
  pythonVersion: string
  markitdownVersion: string | null
  supportedFormats: MarkitdownFormat[]
}

interface RuntimeCache {
  version: 1
  pythonPath: string
}

interface MarkitdownRuntimeManagerOptions {
  runtimeRoot: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
  candidates?: string[]
  runCommand?: MarkitdownCommandRunner
}

function defaultRunCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(command, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    }, (error, stdout, stderr) => {
      if (error) {
        const commandError = new Error(stderr.trim() || error.message) as Error & { code?: string }
        commandError.code = (error as NodeJS.ErrnoException).code
        rejectCommand(commandError)
        return
      }
      resolveCommand({ stdout, stderr })
    })
  })
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export function buildPythonCandidates(options: {
  homeDir: string
  managedPythonPath: string
  cachedPythonPath?: string
  env?: NodeJS.ProcessEnv
}): string[] {
  const { homeDir, managedPythonPath, cachedPythonPath, env = process.env } = options
  return unique([
    managedPythonPath,
    cachedPythonPath,
    env.SUMI_PYTHON,
    env.PYTHON,
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    join(homeDir, '.local', 'bin', 'python3'),
    join(homeDir, '.pyenv', 'shims', 'python3'),
    join(homeDir, '.asdf', 'shims', 'python3'),
    join(homeDir, 'miniconda3', 'bin', 'python3'),
    join(homeDir, 'anaconda3', 'bin', 'python3'),
    '/usr/bin/python3',
    'python3',
    'python',
  ])
}

export function isSupportedPythonVersion(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 3 || (major === 3 && minor >= 10)
}

function normalizeFormats(formats?: MarkitdownFormat[]): MarkitdownFormat[] {
  if (!formats || formats.length === 0) return [...MARKITDOWN_FORMATS]
  const requested = new Set(formats)
  return MARKITDOWN_FORMATS.filter(format => requested.has(format))
}

function supportsFormats(probe: PythonProbe, formats: MarkitdownFormat[]): boolean {
  return Boolean(probe.markitdownVersion) && formats.every(format => probe.supportedFormats.includes(format))
}

function parseProbeOutput(stdout: string): PythonProbe | null {
  const line = stdout.split(/\r?\n/).find(value => value.startsWith(PROBE_SENTINEL))
  if (!line) return null

  try {
    const parsed = JSON.parse(line.slice(PROBE_SENTINEL.length)) as Partial<PythonProbe>
    if (typeof parsed.executable !== 'string' || typeof parsed.pythonVersion !== 'string') return null
    return {
      executable: parsed.executable,
      pythonVersion: parsed.pythonVersion,
      markitdownVersion: typeof parsed.markitdownVersion === 'string' ? parsed.markitdownVersion : null,
      supportedFormats: Array.isArray(parsed.supportedFormats)
        ? parsed.supportedFormats.filter((format): format is MarkitdownFormat => MARKITDOWN_FORMATS.includes(format as MarkitdownFormat))
        : [],
    }
  } catch {
    return null
  }
}

function formatInstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|timed?\s*out|Could not fetch URL|Temporary failure|Name or service not known|SSL|certificate/i.test(message)) {
    return '下载附件解析组件失败，请检查网络后重试。'
  }
  if (/No module named (?:venv|ensurepip)|ensurepip is not available/i.test(message)) {
    return '当前 Python 缺少创建独立环境所需的 venv/pip，请安装完整的 Python 3.10 或更高版本。'
  }
  return '附件解析组件安装失败，请稍后重试。'
}

export class MarkitdownRuntimeManager {
  private readonly runtimeRoot: string
  private readonly homeDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly fixedCandidates?: string[]
  private readonly runCommand: MarkitdownCommandRunner
  private readyProbe: PythonProbe | null = null
  private installPromise: Promise<MarkitdownRuntimeInstallResult> | null = null

  constructor(options: MarkitdownRuntimeManagerOptions) {
    this.runtimeRoot = options.runtimeRoot
    this.homeDir = options.homeDir || homedir()
    this.env = options.env || process.env
    this.fixedCandidates = options.candidates
    this.runCommand = options.runCommand || defaultRunCommand
  }

  private get managedVenvPath(): string {
    return join(this.runtimeRoot, 'venv')
  }

  private get managedPythonPath(): string {
    return join(this.managedVenvPath, 'bin', 'python3')
  }

  private get cachePath(): string {
    return join(this.runtimeRoot, 'runtime.json')
  }

  private isManagedPath(filePath: string): boolean {
    const root = resolve(this.managedVenvPath)
    const candidate = resolve(filePath)
    return candidate === root || candidate.startsWith(`${root}${sep}`)
  }

  private async readCachedPythonPath(): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf-8')) as Partial<RuntimeCache>
      return parsed.version === 1 && typeof parsed.pythonPath === 'string' ? parsed.pythonPath : undefined
    } catch {
      return undefined
    }
  }

  private async writeCache(pythonPath: string): Promise<void> {
    try {
      await mkdir(dirname(this.cachePath), { recursive: true })
      const cache: RuntimeCache = { version: 1, pythonPath }
      await atomicWriteTextFile(this.cachePath, `${JSON.stringify(cache, null, 2)}\n`)
    } catch (error) {
      console.warn('[MarkItDown] failed to cache runtime path:', error)
    }
  }

  private async discoverVersionedCandidates(): Promise<string[]> {
    const roots = [
      join(this.homeDir, '.pyenv', 'versions'),
      join(this.homeDir, '.local', 'share', 'uv', 'python'),
      join(this.homeDir, 'miniconda3', 'envs'),
      join(this.homeDir, 'anaconda3', 'envs'),
    ]
    const candidates: string[] = []

    for (const root of roots) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) candidates.push(join(root, entry.name, 'bin', 'python3'))
        }
      } catch {
        // Optional runtime manager directory is absent.
      }
    }
    return candidates
  }

  private async candidates(): Promise<string[]> {
    if (this.fixedCandidates) return unique([this.managedPythonPath, ...this.fixedCandidates])
    const cachedPythonPath = await this.readCachedPythonPath()
    const common = buildPythonCandidates({
      homeDir: this.homeDir,
      managedPythonPath: this.managedPythonPath,
      cachedPythonPath,
      env: this.env,
    })
    return unique([...common, ...await this.discoverVersionedCandidates()])
  }

  private async probe(candidate: string): Promise<PythonProbe | null> {
    try {
      const { stdout } = await this.runCommand(candidate, ['-c', PYTHON_PROBE_SCRIPT], PROBE_TIMEOUT_MS)
      return parseProbeOutput(stdout)
    } catch {
      return null
    }
  }

  async getStatus(formats?: MarkitdownFormat[]): Promise<MarkitdownRuntimeStatus> {
    const requiredFormats = normalizeFormats(formats)
    if (this.readyProbe && this.isCompatibleRuntime(this.readyProbe, requiredFormats)) {
      return this.readyStatus(this.readyProbe)
    }

    let installableProbe: PythonProbe | null = null
    const seenExecutables = new Set<string>()
    for (const candidate of await this.candidates()) {
      const probe = await this.probe(candidate)
      if (!probe || seenExecutables.has(probe.executable)) continue
      seenExecutables.add(probe.executable)

      if (this.isCompatibleRuntime(probe, requiredFormats)) {
        this.readyProbe = probe
        await this.writeCache(probe.executable)
        return this.readyStatus(probe)
      }
      if (!installableProbe && !this.isManagedPath(probe.executable) && isSupportedPythonVersion(probe.pythonVersion)) {
        installableProbe = probe
      }
    }

    if (installableProbe) {
      return {
        state: 'installable',
        pythonPath: installableProbe.executable,
        pythonVersion: installableProbe.pythonVersion,
        missingFormats: requiredFormats.filter(format => !installableProbe?.supportedFormats.includes(format)),
      }
    }
    return { state: 'python-missing', minimumPythonVersion: MINIMUM_PYTHON_VERSION }
  }

  private readyStatus(probe: PythonProbe): Extract<MarkitdownRuntimeStatus, { state: 'ready' }> {
    return {
      state: 'ready',
      source: this.isManagedPath(probe.executable) ? 'managed' : 'external',
      pythonPath: probe.executable,
      pythonVersion: probe.pythonVersion,
      markitdownVersion: probe.markitdownVersion || MARKITDOWN_VERSION,
      supportedFormats: probe.supportedFormats,
    }
  }

  private isCompatibleRuntime(probe: PythonProbe, formats: MarkitdownFormat[]): boolean {
    if (!supportsFormats(probe, formats)) return false
    return !this.isManagedPath(probe.executable) || probe.markitdownVersion === MARKITDOWN_VERSION
  }

  install(): Promise<MarkitdownRuntimeInstallResult> {
    if (!this.installPromise) {
      this.installPromise = this.performInstall().finally(() => {
        this.installPromise = null
      })
    }
    return this.installPromise
  }

  private async performInstall(): Promise<MarkitdownRuntimeInstallResult> {
    const status = await this.getStatus()
    if (status.state === 'ready') return { success: true, status }
    if (status.state === 'python-missing') {
      return {
        success: false,
        error: `未找到可用的 Python ${MINIMUM_PYTHON_VERSION} 或更高版本，请先安装 Python。`,
      }
    }

    await mkdir(this.runtimeRoot, { recursive: true })
    const temporaryVenvPath = join(this.runtimeRoot, `venv.install-${randomUUID()}`)
    const temporaryPythonPath = join(temporaryVenvPath, 'bin', 'python3')

    try {
      await this.runCommand(status.pythonPath, ['-m', 'venv', '--copies', temporaryVenvPath], INSTALL_TIMEOUT_MS)
      await this.runCommand(temporaryPythonPath, [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--index-url',
        'https://pypi.org/simple',
        MARKITDOWN_PACKAGE_SPEC,
      ], INSTALL_TIMEOUT_MS)

      const temporaryProbe = await this.probe(temporaryPythonPath)
      if (!temporaryProbe || !supportsFormats(temporaryProbe, [...MARKITDOWN_FORMATS])) {
        throw new Error('Installed runtime did not pass capability checks')
      }

      await rm(this.managedVenvPath, { recursive: true, force: true })
      await rename(temporaryVenvPath, this.managedVenvPath)

      const managedProbe = await this.probe(this.managedPythonPath)
      if (!managedProbe || !supportsFormats(managedProbe, [...MARKITDOWN_FORMATS])) {
        throw new Error('Managed runtime did not pass final capability checks')
      }

      this.readyProbe = managedProbe
      await this.writeCache(managedProbe.executable)
      return { success: true, status: this.readyStatus(managedProbe) }
    } catch (error) {
      console.error('[MarkItDown] runtime installation failed:', error)
      return { success: false, error: formatInstallError(error) }
    } finally {
      await rm(temporaryVenvPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

let defaultManager: MarkitdownRuntimeManager | null = null

export function getMarkitdownRuntimeManager(): MarkitdownRuntimeManager {
  if (!defaultManager) {
    defaultManager = new MarkitdownRuntimeManager({
      runtimeRoot: join(getAppUserDataDir(), 'runtimes', 'markitdown'),
    })
  }
  return defaultManager
}
