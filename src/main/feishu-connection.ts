import { execFile, spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { mkdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  getFeishuCliConfigDir,
  getFeishuCliProcessEnv,
  getFeishuCliRuntimeManager,
  type FeishuCliRuntimeManager,
} from './feishu-runtime'
import type {
  FeishuAuthChallenge,
  FeishuCapabilityId,
  FeishuConnectorActionResult,
  FeishuConnectorIdentity,
  FeishuConnectorStatus,
} from '../shared/feishu-types'
import { getFeishuCapability } from '../shared/feishu-types'

type FeishuSetupOperation = 'configure' | 'login' | 'grant-capability'

interface CliResult {
  stdout: string
  stderr: string
}

export function buildFeishuCapabilityAuthorizationArgs(
  capabilityId: FeishuCapabilityId,
): string[] | null {
  const capability = getFeishuCapability(capabilityId)
  return capability
    ? ['auth', 'login', '--domain', capability.cliDomains.join(','), '--json']
    : null
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function findHttpsUrls(value: string): string[] {
  const urls: string[] = []
  for (const match of stripAnsi(value).matchAll(/https:\/\/[^\s"'<>]+/g)) {
    const candidate = match[0].replace(/[),，。；;]+$/g, '')
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'https:') urls.push(parsed.toString())
    } catch {
      // Ignore partial URLs emitted across stream chunk boundaries.
    }
  }
  return [...new Set(urls)]
}

function parseJsonOutput(stdout: string): Record<string, unknown> | null {
  const text = stripAnsi(stdout).trim()
  const candidates = [text, ...text.split('\n').reverse()]
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Try the next candidate because CLI notices may precede JSON output.
    }
  }
  return null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function stringArrayValue(value: unknown): string[] | undefined {
  const values = typeof value === 'string'
    ? value.split(/\s+/)
    : Array.isArray(value) ? value : []
  const normalized = values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
  return normalized.length > 0 ? [...new Set(normalized)] : undefined
}

function statusIsAvailable(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  return ['authorized', 'authenticated', 'available', 'connected', 'ready', 'valid', 'active']
    .includes(value.toLowerCase())
}

export function parseFeishuAuthIdentity(payload: Record<string, unknown> | null): FeishuConnectorIdentity | null {
  if (!payload) return null
  const data = objectValue(payload.data)
  const root = Object.keys(data).length > 0 ? data : payload
  const identity = objectValue(root.identity)
  const identities = objectValue(root.identities)
  const user = objectValue(identities.user)
  const bot = objectValue(identities.bot)

  const userAvailable = user.available === true
    || user.verified === true
    || statusIsAvailable(user.status)
    || statusIsAvailable(user.tokenStatus)
  const botAvailable = bot.available === true
    || bot.verified === true
    || statusIsAvailable(bot.status)
    || statusIsAvailable(bot.tokenStatus)
    || identity.type === 'bot'
    || root.identity === 'bot'

  if (!userAvailable && !botAvailable) return null
  return {
    displayName: stringValue(
      identity.userName,
      identity.displayName,
      user.userName,
      user.displayName,
      root.userName,
      bot.appName,
    ),
    openId: stringValue(identity.openId, user.openId, root.openId, bot.openId),
    userAvailable,
    botAvailable,
    userScopes: stringArrayValue(user.scope),
  }
}

function friendlyCliError(value: string): string {
  const sanitized = stripAnsi(value)
    .replace(/https:\/\/[^\s]+/g, '[授权链接]')
    .replace(/\b(?:t-|u-|a-)?[A-Za-z0-9_-]{32,}\b/g, '[已隐藏]')
    .trim()
  if (!sanitized) return '飞书 CLI 操作失败，请重试'
  return sanitized.slice(-500)
}

export class FeishuConnectorManager extends EventEmitter {
  private activeProcess: ChildProcess | null = null
  private activeOperation: FeishuSetupOperation | null = null
  private activeCapabilityId: FeishuCapabilityId | null = null
  private lastError: string | null = null
  private streamBuffer = ''
  private emittedChallengeUrls = new Set<string>()

  constructor(
    private readonly runtime: Pick<FeishuCliRuntimeManager, 'getStatus' | 'install'> = getFeishuCliRuntimeManager(),
  ) {
    super()
  }

  private async configExists(): Promise<boolean> {
    try {
      const config = await stat(join(getFeishuCliConfigDir(), 'config.json'))
      return config.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private execute(executablePath: string, args: string[], timeoutMs = 20_000): Promise<CliResult> {
    return new Promise((resolveCommand, rejectCommand) => {
      execFile(executablePath, args, {
        cwd: getFeishuCliConfigDir(),
        env: getFeishuCliProcessEnv(),
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          rejectCommand(new Error(stderr.trim() || stdout.trim() || error.message))
          return
        }
        resolveCommand({ stdout, stderr })
      })
    })
  }

  async getStatus(options: { verify?: boolean } = {}): Promise<FeishuConnectorStatus> {
    const runtime = await this.runtime.getStatus()
    if (runtime.state !== 'ready') return { phase: 'runtime-missing', runtime }
    if (this.activeOperation) {
      return {
        phase: this.activeOperation === 'configure' ? 'configuring' : 'authorizing',
        runtime,
        activeCapabilityId: this.activeCapabilityId ?? undefined,
      }
    }
    if (this.lastError) return { phase: 'error', runtime, error: this.lastError }
    if (!await this.configExists()) return { phase: 'not-configured', runtime }

    try {
      const args = ['auth', 'status', '--json']
      if (options.verify !== false) args.push('--verify')
      const result = await this.execute(runtime.executablePath, args)
      const identity = parseFeishuAuthIdentity(parseJsonOutput(result.stdout))
      if (!identity) return { phase: 'unauthorized', runtime }
      return identity.userAvailable
        ? { phase: 'connected', runtime, identity }
        : { phase: 'bot-only', runtime, identity }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not logged in|token.missing|unauthorized|authentication|登录|授权/i.test(message)) {
        return { phase: 'unauthorized', runtime }
      }
      return { phase: 'error', runtime, error: friendlyCliError(message) }
    }
  }

  async installRuntime(): Promise<FeishuConnectorActionResult> {
    const result = await this.runtime.install()
    if (!result.success) return result
    this.lastError = null
    await this.emitStatus()
    return { success: true }
  }

  async startConfigure(): Promise<FeishuConnectorActionResult> {
    return this.startOperation('configure')
  }

  async startLogin(): Promise<FeishuConnectorActionResult> {
    if (!await this.configExists()) return { success: false, error: '请先配置飞书应用' }
    return this.startOperation('login')
  }

  async grantCapability(capabilityId: FeishuCapabilityId): Promise<FeishuConnectorActionResult> {
    const capability = getFeishuCapability(capabilityId)
    if (!capability) return { success: false, error: '不支持该飞书能力' }
    const status = await this.getStatus({ verify: false })
    if (!status.identity?.userAvailable) {
      return { success: false, error: '请先登录飞书账号' }
    }
    return this.startOperation('grant-capability', capabilityId)
  }

  private async startOperation(
    operation: FeishuSetupOperation,
    capabilityId?: FeishuCapabilityId,
  ): Promise<FeishuConnectorActionResult> {
    if (this.activeProcess) return { success: false, error: '已有飞书连接操作正在进行' }
    const runtime = await this.runtime.getStatus()
    if (runtime.state !== 'ready') return { success: false, error: '请先安装飞书 CLI 运行组件' }

    await mkdir(getFeishuCliConfigDir(), { recursive: true, mode: 0o700 })
    this.lastError = null
    this.streamBuffer = ''
    this.emittedChallengeUrls.clear()
    const capabilityArgs = capabilityId
      ? buildFeishuCapabilityAuthorizationArgs(capabilityId)
      : null
    const args = operation === 'configure'
      ? ['config', 'init', '--new', '--brand', 'feishu', '--lang', 'zh']
      : operation === 'grant-capability' && capabilityArgs
        ? capabilityArgs
        : ['auth', 'login', '--recommend', '--json']
    const child = spawn(runtime.executablePath, args, {
      cwd: getFeishuCliConfigDir(),
      env: getFeishuCliProcessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.activeProcess = child
    this.activeOperation = operation
    this.activeCapabilityId = operation === 'grant-capability' ? capabilityId ?? null : null
    child.stdout.on('data', (chunk: Buffer) => this.handleOperationOutput(
      operation,
      chunk.toString('utf8'),
      capabilityId,
    ))
    child.stderr.on('data', (chunk: Buffer) => this.handleOperationOutput(
      operation,
      chunk.toString('utf8'),
      capabilityId,
    ))
    child.once('error', (error) => {
      this.lastError = friendlyCliError(error.message)
    })
    child.once('close', (code, signal) => {
      if (this.activeProcess !== child) return
      this.activeProcess = null
      this.activeOperation = null
      this.activeCapabilityId = null
      if (code !== 0 && signal !== 'SIGTERM') {
        this.lastError = friendlyCliError(this.streamBuffer || `飞书 CLI 退出码 ${String(code)}`)
      }
      void this.emitStatus()
    })
    await this.emitStatus()
    return { success: true }
  }

  private handleOperationOutput(
    operation: FeishuSetupOperation,
    output: string,
    capabilityId?: FeishuCapabilityId,
  ): void {
    this.streamBuffer = `${this.streamBuffer}${output}`.slice(-16_000)
    for (const url of findHttpsUrls(this.streamBuffer)) {
      if (this.emittedChallengeUrls.has(url)) continue
      this.emittedChallengeUrls.add(url)
      const challenge: FeishuAuthChallenge = { operation, capabilityId, url }
      this.emit('auth-challenge', challenge)
    }
  }

  async cancelOperation(): Promise<FeishuConnectorActionResult> {
    if (!this.activeProcess) return { success: true }
    this.activeProcess.kill('SIGTERM')
    this.activeProcess = null
    this.activeOperation = null
    this.activeCapabilityId = null
    this.lastError = null
    await this.emitStatus()
    return { success: true }
  }

  async logout(): Promise<FeishuConnectorActionResult> {
    const runtime = await this.runtime.getStatus()
    if (runtime.state !== 'ready') return { success: true }
    if (!await this.configExists()) return { success: true }
    try {
      await this.execute(runtime.executablePath, ['auth', 'logout', '--json'])
      this.lastError = null
      await this.emitStatus()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: friendlyCliError(error instanceof Error ? error.message : String(error)),
      }
    }
  }

  private async emitStatus(): Promise<void> {
    try {
      this.emit('status-changed', await this.getStatus())
    } catch (error) {
      const runtime = await this.runtime.getStatus()
      this.emit('status-changed', {
        phase: 'error',
        runtime,
        error: friendlyCliError(error instanceof Error ? error.message : String(error)),
      } satisfies FeishuConnectorStatus)
    }
  }
}

let defaultManager: FeishuConnectorManager | null = null

export function getFeishuConnectorManager(): FeishuConnectorManager {
  if (!defaultManager) defaultManager = new FeishuConnectorManager()
  return defaultManager
}

export async function filterFeishuSkillByConnectorReadiness(
  skillIds: string[],
  statusReader: Pick<FeishuConnectorManager, 'getStatus'> = getFeishuConnectorManager(),
): Promise<string[]> {
  if (!skillIds.includes('feishu')) return skillIds
  // Readiness filtering runs on every interactive query. Local token state is
  // enough here; the Skill performs a live --verify check before Feishu work.
  const status = await statusReader.getStatus({ verify: false })
  return status.phase === 'connected' || status.phase === 'bot-only'
    ? skillIds
    : skillIds.filter(skillId => skillId !== 'feishu')
}
