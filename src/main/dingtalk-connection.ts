import { randomUUID } from 'crypto'
import { DINGTALK_CAPABILITIES, type DingTalkAuthorizationPlan } from '../shared/dingtalk-types'
import { EventEmitter } from 'events'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { shell } from 'electron'
import { getDingTalkCliConfigDir, getDingTalkCliProcessEnv, getDingTalkCliRuntimeManager, type DingTalkCliRuntimeManager } from './dingtalk-runtime'
import type { DingTalkConnectorActionResult, DingTalkConnectorStatus } from '../shared/dingtalk-types'

export function isTrustedDingTalkAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'login.dingtalk.com' &&
      !url.username && !url.password && !url.port && url.pathname === '/oauth2/auth'
  } catch { return false }
}

export function parseDingTalkIdentity(raw: string): DingTalkConnectorStatus['identity'] {
  const value = JSON.parse(raw) as Record<string, unknown>
  if (!value || value.authenticated !== true) return undefined
  return {
    userName: typeof value.user_name === 'string' ? value.user_name : '钉钉用户',
    corpName: typeof value.corp_name === 'string' ? value.corp_name : '已授权组织',
  }
}

export function parseDingTalkAuthorizationScopes(raw: string): string[] {
  const body = JSON.parse(raw) as { success?: boolean; data?: { selectedScopes?: unknown } }
  const scopes = body.data?.selectedScopes
  if (body.success !== true || !Array.isArray(scopes) || scopes.length > 200 ||
    !scopes.every((scope) => typeof scope === 'string' && /^[a-z][a-z0-9_.-]*:[a-z][a-z0-9_.-]*$/.test(scope))) {
    throw new Error('无效的钉钉授权计划')
  }
  return [...new Set(scopes as string[])]
}

export class DingTalkConnectorManager extends EventEmitter {
  private plan: { id: string; scopes: string[]; expires: number } | null = null
  private active: ChildProcess | null = null
  private operation: 'installing' | 'authorizing' | 'logout' | 'permissions' | null = null
  private authorizationUrl: string | undefined
  private error: string | undefined
  private loginDone: Promise<void> | null = null
  private cancelled = false
  private statusFlight: Promise<DingTalkConnectorStatus> | null = null

  constructor(private readonly runtime: Pick<DingTalkCliRuntimeManager, 'getStatus' | 'install'> = getDingTalkCliRuntimeManager()) { super() }

  getStatus(): Promise<DingTalkConnectorStatus> {
    if (!this.statusFlight) this.statusFlight = this.readStatus().finally(() => { this.statusFlight = null })
    return this.statusFlight
  }

  private async readStatus(): Promise<DingTalkConnectorStatus> {
    const runtime = await this.runtime.getStatus()
    if (runtime.state !== 'ready') return { phase: this.operation === 'installing' ? 'installing' : 'runtime-missing', runtime, error: this.error }
    if (this.operation) return { phase: this.operation === 'installing' ? 'installing' : 'authorizing', runtime, authorizationUrl: this.authorizationUrl }
    if (this.error) return { phase: 'error', runtime, error: this.error }
    try {
      const raw = await this.execute(runtime.executablePath, ['auth', 'status', '--format', 'json'])
      const identity = parseDingTalkIdentity(raw)
      return { phase: identity ? 'connected' : 'unauthorized', runtime, identity }
    } catch {
      return { phase: 'error', runtime, error: '无法验证钉钉登录状态，请检查网络或重新登录。' }
    }
  }

  private execute(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(executable, args, { env: getDingTalkCliProcessEnv(), encoding: 'utf8', timeout: 25_000, maxBuffer: 512 * 1024 }, (error, stdout) => {
        // auth status can return a structured unauthenticated result with nonzero exit.
        if (error && !(args[1] === 'status' && stdout.trim().startsWith('{'))) reject(new Error('钉钉命令未完成'))
        else resolve(stdout)
      })
    })
  }

  private async publish(): Promise<void> {
    // Wait for an older status probe before emitting the new operation state.
    await this.statusFlight?.catch(() => undefined)
    this.emit('status-changed', await this.getStatus())
  }

  async installRuntime(): Promise<DingTalkConnectorActionResult> {
    if (this.operation) return { success: false, error: '钉钉连接器正在处理其他操作' }
    this.operation = 'installing'
    this.error = undefined
    try {
      await this.publish()
      const result = await this.runtime.install()
      if (!result.success) this.error = result.error
      return result
    } catch { this.error = '钉钉组件安装失败，请重试'; return { success: false, error: this.error } }
    finally { this.operation = null; await this.publish() }
  }

  async startLogin(): Promise<DingTalkConnectorActionResult> {
    if (this.operation) return { success: false, error: '钉钉连接器正在处理其他操作' }
    this.plan = null
    this.operation = 'authorizing'
    this.cancelled = false
    this.error = undefined
    this.authorizationUrl = undefined
    try {
      const runtime = await this.runtime.getStatus()
      if (runtime.state !== 'ready') throw new Error('请先安装钉钉组件')
      const config = getDingTalkCliConfigDir()
      await mkdir(config, { recursive: true, mode: 0o700 })
      // Product calls must report missing scopes instead of opening browsers from the Agent.
      await writeFile(join(config, 'pat_policy.json'), JSON.stringify({ default: { openBrowser: false } }), { mode: 0o600 })
      if (this.cancelled) { this.operation = null; await this.publish(); return { success: false, error: '已取消登录' } }
      const child = spawn(runtime.executablePath, ['auth', 'login', '--no-browser', '--format', 'json'], {
        env: getDingTalkCliProcessEnv(), stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.active = child
      this.loginDone = new Promise<void>((resolve) => {
        let buffer = ''
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 300_000)
        const consume = (chunk: Buffer) => {
          buffer += chunk.toString('utf8')
          let newline: number
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            for (const value of line.match(/https:\/\/[^\s<>"']+/g) || []) {
              if (!isTrustedDingTalkAuthorizationUrl(value) || this.authorizationUrl || this.cancelled) continue
              this.authorizationUrl = value
              void this.publish().catch(() => undefined)
              void shell.openExternal(value).catch(() => {
                this.error = '无法打开浏览器，请点击重新打开授权页。'
                void this.publish().catch(() => undefined)
              })
            }
          }
          if (buffer.length > 16_384) buffer = ''
        }
        child.stdout?.on('data', consume)
        child.stderr?.on('data', consume)
        child.once('error', () => { this.error = '无法启动钉钉登录，请重新安装组件。' })
        child.once('close', (code) => {
          clearTimeout(timer)
          this.active = null
          this.operation = null
          this.authorizationUrl = undefined
          if (!this.cancelled && (code !== 0 || timedOut)) this.error = timedOut ? '授权已超时，请重新登录。' : '登录未完成，请确认组织已开通 CLI 访问后重试。'
          resolve()
          void this.publish().catch(() => undefined)
        })
      })
      await this.publish()
      return { success: true }
    } catch (error) {
      this.operation = null
      this.error = error instanceof Error ? error.message : '启动登录失败'
      await this.publish()
      return { success: false, error: this.error }
    }
  }

  async reopenAuthorization(): Promise<DingTalkConnectorActionResult> {
    if (!this.authorizationUrl || !isTrustedDingTalkAuthorizationUrl(this.authorizationUrl)) return { success: false, error: '当前没有等待中的授权' }
    try { await shell.openExternal(this.authorizationUrl); return { success: true } }
    catch { return { success: false, error: '无法打开授权页' } }
  }

  async cancelOperation(): Promise<DingTalkConnectorActionResult> {
    if (this.operation !== 'authorizing') return { success: false, error: '当前没有等待中的登录' }
    this.cancelled = true
    this.error = undefined
    this.authorizationUrl = undefined
    this.active?.kill('SIGKILL')
    await this.loginDone
    return { success: true }
  }

  async prepareAuthorization(product: string): Promise<DingTalkAuthorizationPlan> {
    if (!DINGTALK_CAPABILITIES.some((item) => item.id === product)) return { success: false, error: '不支持该钉钉能力' }
    if (this.operation) return { success: false, error: '连接器正在处理其他操作' }
    this.operation = 'permissions'
    this.plan = null
    try {
      const runtime = await this.runtime.getStatus()
      if (runtime.state !== 'ready') throw new Error('组件未就绪')
      const raw = await this.execute(runtime.executablePath, ['pat', 'chmod', '--products', product, '--grant-type', 'permanent', '--dry-run', '--format', 'json'])
      const scopes = parseDingTalkAuthorizationScopes(raw)
      const id = randomUUID()
      this.plan = { id, scopes, expires: Date.now() + 300_000 }
      return { success: true, planId: id, scopes }
    } catch { return { success: false, error: '无法获取授权范围，请确认已登录且组织已开通此能力。' } }
    finally { this.operation = null }
  }

  async grantAuthorization(planId: string): Promise<DingTalkConnectorActionResult> {
    const plan = this.plan
    if (this.operation || !plan || plan.id !== planId || plan.expires < Date.now()) return { success: false, error: '授权计划已过期，请重新选择能力' }
    this.plan = null
    if (!plan.scopes.length) return { success: true }
    this.operation = 'permissions'
    try {
      const runtime = await this.runtime.getStatus()
      if (runtime.state !== 'ready') throw new Error('组件未就绪')
      const raw = await this.execute(runtime.executablePath, ['pat', 'chmod', ...plan.scopes, '--grant-type', 'permanent', '--yes', '--format', 'json'])
      const result = JSON.parse(raw) as { success?: boolean; data?: { grantedScopes?: unknown; pendingScopes?: unknown[] } }
      const granted = result.data?.grantedScopes
      if (result.success !== true || !Array.isArray(granted) ||
        !plan.scopes.every((scope) => granted.includes(scope)) || result.data?.pendingScopes?.length) {
        throw new Error('授权未完成')
      }
      return { success: true }
    } catch { return { success: false, error: '授权未完成，组织策略可能需要管理员处理；尚未确认的权限不会视为已授权。' } }
    finally { this.operation = null }
  }

  async logout(): Promise<DingTalkConnectorActionResult> {
    if (this.operation) return { success: false, error: '请先结束当前操作' }
    this.plan = null
    this.operation = 'logout'
    this.error = undefined
    try {
      const runtime = await this.runtime.getStatus()
      if (runtime.state !== 'ready') throw new Error('钉钉组件未就绪')
      await this.execute(runtime.executablePath, ['auth', 'logout'])
      return { success: true }
    } catch { this.error = '断开钉钉连接失败，请重试'; return { success: false, error: this.error } }
    finally { this.operation = null; await this.publish() }
  }
}

let manager: DingTalkConnectorManager | undefined
export function getDingTalkConnectorManager(): DingTalkConnectorManager {
  return manager ??= new DingTalkConnectorManager()
}
export async function filterDingTalkSkillByConnectorReadiness(
  skillIds: string[],
  statusReader: Pick<DingTalkConnectorManager, 'getStatus'> = getDingTalkConnectorManager(),
): Promise<string[]> {
  if (!skillIds.includes('dingtalk')) return skillIds
  return (await statusReader.getStatus()).phase === 'connected'
    ? skillIds : skillIds.filter((id) => id !== 'dingtalk')
}
