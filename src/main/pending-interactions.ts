import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import {
  cancelPermissionNotification,
  schedulePermissionNotification,
} from './notification-manager'

const DEFAULT_TIMEOUT_MS = 300_000

export type PermissionResponseOptions = {
  updatedPermissions?: PermissionUpdate[]
  decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
}

export type PermissionNotificationAdapter = {
  schedule: (requestId: string, toolName: string) => void
  cancel: (requestId: string) => void
}

export type PermissionBeforeAllowResult =
  | { success: true }
  | { success: false; message: string }

type PendingEntry = {
  sessionId: string
  finish: (result: PermissionResult) => void
}

type PendingPermission = PendingEntry & {
  input: Record<string, unknown>
  beforeAllow?: (signal: AbortSignal) => Promise<PermissionBeforeAllowResult>
  beforeAllowAbortController: AbortController
  resolving: boolean
}

type PendingAskUser = PendingEntry & {
  originalInput: Record<string, unknown>
}

type PermissionRequest = {
  sessionId: string
  toolName: string
  input: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  onRequest: (requestId: string) => void
  onTimeout: (requestId: string) => void
  onCancelled: (requestId: string) => void
  beforeAllow?: (signal: AbortSignal) => Promise<PermissionBeforeAllowResult>
}

type AskUserRequest = {
  sessionId: string
  originalInput: Record<string, unknown>
  timeoutMs?: number
  onRequest: (requestId: string) => void
  onTimeout: (requestId: string) => void
}

const defaultNotificationAdapter: PermissionNotificationAdapter = {
  schedule: schedulePermissionNotification,
  cancel: cancelPermissionNotification,
}

export class PendingInteractionController {
  private permissions = new Map<string, PendingPermission>()
  private askUserRequests = new Map<string, PendingAskUser>()

  constructor(private readonly notifications = defaultNotificationAdapter) {}

  requestPermission(request: PermissionRequest): Promise<PermissionResult> {
    const requestId = this.createRequestId('perm')
    return new Promise<PermissionResult>((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout>
      let abortHandler: (() => void) | null = null

      const finish = (result: PermissionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        const pending = this.permissions.get(requestId)
        pending?.beforeAllowAbortController.abort()
        this.permissions.delete(requestId)
        this.notifications.cancel(requestId)
        if (request.signal && abortHandler) {
          request.signal.removeEventListener('abort', abortHandler)
        }
        resolve(result)
      }

      timeout = setTimeout(() => {
        if (!this.permissions.has(requestId)) return
        request.onTimeout(requestId)
        finish({ behavior: 'deny', message: 'Permission request timed out' })
      }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      this.permissions.set(requestId, {
        sessionId: request.sessionId,
        input: request.input,
        beforeAllow: request.beforeAllow,
        beforeAllowAbortController: new AbortController(),
        resolving: false,
        finish,
      })

      abortHandler = () => {
        if (!this.permissions.has(requestId)) return
        request.onCancelled(requestId)
        finish({ behavior: 'deny', message: 'Tool use cancelled by SDK' })
      }
      if (request.signal) {
        if (request.signal.aborted) {
          abortHandler()
          return
        }
        request.signal.addEventListener('abort', abortHandler, { once: true })
      }

      request.onRequest(requestId)
      this.notifications.schedule(requestId, request.toolName)
    })
  }

  requestAskUser(request: AskUserRequest): Promise<PermissionResult> {
    const requestId = this.createRequestId('ask')
    return new Promise<PermissionResult>((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout>

      const finish = (result: PermissionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.askUserRequests.delete(requestId)
        resolve(result)
      }

      timeout = setTimeout(() => {
        if (!this.askUserRequests.has(requestId)) return
        request.onTimeout(requestId)
        finish({
          behavior: 'deny',
          message: 'AskUserQuestion timed out — user did not respond',
        })
      }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      this.askUserRequests.set(requestId, {
        sessionId: request.sessionId,
        originalInput: request.originalInput,
        finish,
      })
      request.onRequest(requestId)
    })
  }

  async resolvePermission(
    requestId: string,
    behavior: 'allow' | 'deny',
    options?: PermissionResponseOptions,
  ): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (!pending) return
    if (behavior === 'allow') {
      if (pending.beforeAllow) {
        if (pending.resolving) return
        pending.resolving = true
        try {
          const result = await pending.beforeAllow(pending.beforeAllowAbortController.signal)
          if (this.permissions.get(requestId) !== pending) return
          if (!result.success) {
            pending.finish({
              behavior: 'deny',
              message: result.message,
              decisionClassification: 'user_reject',
            })
            return
          }
          pending.finish({
            behavior: 'allow',
            updatedInput: pending.input,
            updatedPermissions: options?.updatedPermissions,
            decisionClassification: options?.decisionClassification ?? 'user_temporary',
          })
        } catch (error) {
          if (this.permissions.get(requestId) !== pending) return
          pending.finish({
            behavior: 'deny',
            message: error instanceof Error ? error.message : '授权未完成',
            decisionClassification: 'user_reject',
          })
        }
        return
      }
      pending.finish({
        behavior: 'allow',
        updatedInput: pending.input,
        updatedPermissions: options?.updatedPermissions,
        decisionClassification: options?.decisionClassification ?? 'user_temporary',
      })
      return
    }
    pending.finish({
      behavior: 'deny',
      message: 'User denied permission',
      decisionClassification: options?.decisionClassification ?? 'user_reject',
    })
  }

  resolveAskUser(requestId: string, answers: Record<string, string>): void {
    const pending = this.askUserRequests.get(requestId)
    if (!pending) return
    pending.finish({
      behavior: 'allow',
      updatedInput: { ...pending.originalInput, answers },
    })
  }

  reject(sessionId?: string): void {
    for (const pending of this.permissions.values()) {
      if (sessionId && pending.sessionId !== sessionId) continue
      pending.finish({ behavior: 'deny', message: 'Query aborted' })
    }
    for (const pending of this.askUserRequests.values()) {
      if (sessionId && pending.sessionId !== sessionId) continue
      pending.finish({ behavior: 'deny', message: 'Query aborted' })
    }
  }

  private createRequestId(prefix: 'ask' | 'perm'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
