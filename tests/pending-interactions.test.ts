import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PendingInteractionController,
  type PermissionNotificationAdapter,
} from '../src/main/pending-interactions'

function setup() {
  const notifications: PermissionNotificationAdapter = {
    schedule: vi.fn(),
    cancel: vi.fn(),
  }
  return {
    controller: new PendingInteractionController(notifications),
    notifications,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PendingInteractionController', () => {
  it('owns permission registration, notification cleanup, and resolution', async () => {
    const { controller, notifications } = setup()
    let requestId = ''
    const pending = controller.requestPermission({
      sessionId: 'session-a',
      toolName: 'Write',
      input: { file_path: '/workspace/a.md' },
      onRequest: (id) => { requestId = id },
      onTimeout: vi.fn(),
      onCancelled: vi.fn(),
    })

    expect(requestId).toMatch(/^perm-/)
    expect(notifications.schedule).toHaveBeenCalledWith(requestId, 'Write')

    controller.resolvePermission(requestId, 'allow', {
      decisionClassification: 'user_permanent',
    })

    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { file_path: '/workspace/a.md' },
      decisionClassification: 'user_permanent',
    })
    expect(notifications.cancel).toHaveBeenCalledWith(requestId)
  })

  it('owns timeout settlement and emits it once', async () => {
    vi.useFakeTimers()
    const { controller, notifications } = setup()
    const onTimeout = vi.fn()
    let requestId = ''
    const pending = controller.requestPermission({
      sessionId: 'session-timeout',
      toolName: 'Bash',
      input: { command: 'echo test' },
      timeoutMs: 100,
      onRequest: (id) => { requestId = id },
      onTimeout,
      onCancelled: vi.fn(),
    })

    vi.advanceTimersByTime(100)

    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: 'Permission request timed out',
    })
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledWith(requestId)
    expect(notifications.cancel).toHaveBeenCalledWith(requestId)
  })

  it('keeps the original tool call pending until an app-owned authorization succeeds', async () => {
    const { controller } = setup()
    let requestId = ''
    let finishAuthorization!: (result: { success: true }) => void
    const beforeAllow = vi.fn((signal: AbortSignal) => new Promise<{ success: true }>((resolve) => {
      expect(signal.aborted).toBe(false)
      finishAuthorization = resolve
    }))
    const pending = controller.requestPermission({
      sessionId: 'session-feishu',
      toolName: 'Bash',
      input: { command: 'lark-cli auth check --scope calendar:calendar.event:read --json' },
      beforeAllow,
      onRequest: (id) => { requestId = id },
      onTimeout: vi.fn(),
      onCancelled: vi.fn(),
    })

    const response = controller.resolvePermission(requestId, 'allow')
    expect(beforeAllow).toHaveBeenCalledOnce()

    finishAuthorization({ success: true })
    await response
    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: {
        command: 'lark-cli auth check --scope calendar:calendar.event:read --json',
      },
    })
  })

  it('denies the paused tool call when connector authorization fails', async () => {
    const { controller } = setup()
    let requestId = ''
    const pending = controller.requestPermission({
      sessionId: 'session-feishu-failed',
      toolName: 'Bash',
      input: { command: 'scope check' },
      beforeAllow: async () => ({ success: false, message: '飞书未授予日历权限' }),
      onRequest: (id) => { requestId = id },
      onTimeout: vi.fn(),
      onCancelled: vi.fn(),
    })

    await controller.resolvePermission(requestId, 'allow')
    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: '飞书未授予日历权限',
      decisionClassification: 'user_reject',
    })
  })

  it('settles an already-aborted permission without emitting a request', async () => {
    const { controller, notifications } = setup()
    const signal = new AbortController()
    signal.abort()
    const onRequest = vi.fn()
    const onCancelled = vi.fn()

    const pending = controller.requestPermission({
      sessionId: 'session-cancelled',
      toolName: 'Read',
      input: { file_path: '/workspace/a.md' },
      signal: signal.signal,
      onRequest,
      onTimeout: vi.fn(),
      onCancelled,
    })

    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool use cancelled by SDK',
    })
    expect(onRequest).not.toHaveBeenCalled()
    expect(onCancelled).toHaveBeenCalledOnce()
    expect(notifications.schedule).not.toHaveBeenCalled()
  })

  it('rejects one session without settling another session', async () => {
    const { controller } = setup()
    let requestA = ''
    let requestB = ''
    const pendingA = controller.requestPermission({
      sessionId: 'session-a',
      toolName: 'Write',
      input: {},
      onRequest: (id) => { requestA = id },
      onTimeout: vi.fn(),
      onCancelled: vi.fn(),
    })
    const pendingB = controller.requestPermission({
      sessionId: 'session-b',
      toolName: 'Write',
      input: {},
      onRequest: (id) => { requestB = id },
      onTimeout: vi.fn(),
      onCancelled: vi.fn(),
    })

    controller.reject('session-a')
    await expect(pendingA).resolves.toEqual({ behavior: 'deny', message: 'Query aborted' })

    controller.resolvePermission(requestB, 'allow')
    await expect(pendingB).resolves.toMatchObject({ behavior: 'allow' })
    expect(requestA).not.toBe(requestB)
  })

  it('merges AskUser answers into the original tool input', async () => {
    const { controller } = setup()
    let requestId = ''
    const pending = controller.requestAskUser({
      sessionId: 'session-ask',
      originalInput: { questions: [{ question: 'Continue?' }] },
      onRequest: (id) => { requestId = id },
      onTimeout: vi.fn(),
    })

    controller.resolveAskUser(requestId, { 'Continue?': 'Yes' })

    await expect(pending).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [{ question: 'Continue?' }],
        answers: { 'Continue?': 'Yes' },
      },
    })
  })
})
