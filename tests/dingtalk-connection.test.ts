import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DingTalkConnectorManager, isTrustedDingTalkAuthorizationUrl, parseDingTalkAuthorizationScopes, parseDingTalkIdentity } from '../src/main/dingtalk-connection'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), openExternal: vi.fn(), writeFile: vi.fn() }))
vi.mock('child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }))
vi.mock('electron', () => ({ shell: { openExternal: mocks.openExternal } }))
vi.mock('fs/promises', () => ({ mkdir: vi.fn(), writeFile: mocks.writeFile }))
vi.mock('../src/main/dingtalk-runtime', () => ({
  getDingTalkCliConfigDir: () => '/isolated/dingtalk',
  getDingTalkCliProcessEnv: () => ({ DWS_CONFIG_DIR: '/isolated/dingtalk', DWS_KEYCHAIN_DIR: '/isolated/keychain' }),
  getDingTalkCliRuntimeManager: vi.fn(),
}))
const ready = { state: 'ready' as const, version: '1.0.61', executablePath: '/runtime/dws' }
function setup() {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }) })
  mocks.spawn.mockReturnValue(child)
  const runtime = { getStatus: vi.fn(async () => ready), install: vi.fn(async () => ({ success: true as const, status: ready })) }
  return { child, runtime, manager: new DingTalkConnectorManager(runtime) }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.openExternal.mockResolvedValue(undefined)
  mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => callback(null, '{"success":true,"authenticated":false}'))
})
afterEach(() => { vi.useRealTimers() })

describe('DingTalk connector', () => {
  it('projects only public identity fields from the official status response', () => {
    expect(parseDingTalkIdentity('{"authenticated":false}')).toBeUndefined()
    expect(parseDingTalkIdentity('{"authenticated":true,"user_name":"User","corp_name":"Org","token":"secret"}')).toEqual({ userName: 'User', corpName: 'Org' })
  })
  it('opens only the official HTTPS authorization endpoint', () => {
    expect(isTrustedDingTalkAuthorizationUrl('https://login.dingtalk.com/oauth2/auth?client_id=x')).toBe(true)
    for (const url of ['http://login.dingtalk.com/oauth2/auth', 'https://login.dingtalk.com.evil.test/oauth2/auth', 'https://user@login.dingtalk.com/oauth2/auth', 'file:///tmp/x', 'https://login.dingtalk.com/other']) expect(isTrustedDingTalkAuthorizationUrl(url)).toBe(false)
  })
  it('rejects malformed scope plans and strips duplicate scopes', () => {
    expect(parseDingTalkAuthorizationScopes('{"success":true,"data":{"selectedScopes":["doc.file:read","doc.file:read"]}}')).toEqual(['doc.file:read'])
    expect(() => parseDingTalkAuthorizationScopes('{"success":true,"data":{"selectedScopes":["--client-secret=x"]}}')).toThrow()
    expect(() => parseDingTalkAuthorizationScopes('{"success":false,"data":{"selectedScopes":[]}}')).toThrow()
  })
  it('deduplicates status probes', async () => {
    const { manager, runtime } = setup()
    await Promise.all([manager.getStatus(), manager.getStatus()])
    expect(runtime.getStatus).toHaveBeenCalledTimes(1)
  })
  it('handles split authorization output, rejects concurrent operations and waits for cancellation', async () => {
    const { manager, child } = setup()
    expect(await manager.startLogin()).toEqual({ success: true })
    expect((await manager.startLogin()).success).toBe(false)
    child.stderr.emit('data', Buffer.from('https://login.dingtalk.com/oauth2/'))
    child.stderr.emit('data', Buffer.from('auth?client_id=x\n'))
    child.stderr.emit('data', Buffer.from('https://login.dingtalk.com/oauth2/auth?client_id=x\n'))
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith('/isolated/dingtalk/pat_policy.json', '{"default":{"openBrowser":false}}', { mode: 0o600 })
    await manager.cancelOperation()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect((await manager.getStatus()).phase).toBe('unauthorized')
  })
  it('terminates a login after five minutes and reports timeout', async () => {
    vi.useFakeTimers()
    const { manager, child } = setup()
    await manager.startLogin()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(child.kill).toHaveBeenCalled()
    expect((await manager.getStatus()).error).toContain('超时')
  })
  it('does not report partial or unconfirmed permission grants as successful', async () => {
    const { manager } = setup()
    mocks.execFile.mockImplementation((_cmd, args, _options, callback) => callback(null, args.includes('--dry-run') ? '{"success":true,"data":{"selectedScopes":["doc.file:read"]}}' : '{"success":true,"data":{"grantedScopes":[]}}'))
    const plan = await manager.prepareAuthorization('doc')
    if (!plan.success) throw new Error('expected plan')
    expect((await manager.grantAuthorization(plan.planId)).success).toBe(false)
  })

  it('grants exactly a prepared plan once, and rejects forged plans', async () => {
    const { manager } = setup()
    expect((await manager.grantAuthorization('forged')).success).toBe(false)
    mocks.execFile.mockImplementation((_cmd, args, _options, callback) => callback(null, args.includes('--dry-run') ? '{"success":true,"data":{"selectedScopes":["doc.file:read"]}}' : '{"success":true,"data":{"grantedScopes":["doc.file:read"]}}'))
    const plan = await manager.prepareAuthorization('doc')
    expect(plan.success).toBe(true)
    if (!plan.success) throw new Error('expected plan')
    expect((await manager.grantAuthorization(plan.planId)).success).toBe(true)
    expect(mocks.execFile.mock.calls[1][1]).toEqual(['pat', 'chmod', 'doc.file:read', '--grant-type', 'permanent', '--yes', '--format', 'json'])
    expect((await manager.grantAuthorization(plan.planId)).success).toBe(false)
    expect((await manager.prepareAuthorization('--token=bad')).success).toBe(false)
  })
})
