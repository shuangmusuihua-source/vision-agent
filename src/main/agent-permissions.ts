import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { AgentContext } from '../shared/types'
import { cancelPermissionNotification } from './notification-manager'

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
}

interface PendingAskUser {
  resolve: (result: PermissionResult) => void
  originalInput: Record<string, unknown>
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
}

const pendingPermissions = new Map<string, PendingPermission>()
const pendingAskUser = new Map<string, PendingAskUser>()

// ─── Registration (called from canUseTool closure) ─────────────────────

export function registerPendingPermission(
  requestId: string,
  resolve: (result: PermissionResult) => void,
  input: Record<string, unknown>,
  timeout: ReturnType<typeof setTimeout>,
  context: AgentContext,
): void {
  pendingPermissions.set(requestId, { resolve, input, timeout, context })
}

export function registerPendingAskUser(
  requestId: string,
  resolve: (result: PermissionResult) => void,
  originalInput: Record<string, unknown>,
  timeout: ReturnType<typeof setTimeout>,
  context: AgentContext,
): void {
  pendingAskUser.set(requestId, { resolve, originalInput, timeout, context })
}

export function hasPendingPermission(requestId: string): boolean {
  return pendingPermissions.has(requestId)
}

export function deletePendingPermission(requestId: string): void {
  pendingPermissions.delete(requestId)
}

export function hasPendingAskUser(requestId: string): boolean {
  return pendingAskUser.has(requestId)
}

export function deletePendingAskUser(requestId: string): void {
  pendingAskUser.delete(requestId)
}

// ─── Resolution (called from agent-handlers) ────────────────────────────

export function resolvePermission(requestId: string, behavior: 'allow' | 'deny'): void {
  const pending = pendingPermissions.get(requestId)
  if (!pending) return
  pendingPermissions.delete(requestId)
  clearTimeout(pending.timeout)
  cancelPermissionNotification(requestId)
  if (behavior === 'allow') {
    pending.resolve({ behavior: 'allow', updatedInput: pending.input })
  } else {
    pending.resolve({ behavior: 'deny', message: 'User denied permission' })
  }
}

export function resolveAskUser(requestId: string, answer: string): void {
  const pending = pendingAskUser.get(requestId)
  if (!pending) {
    console.warn(`[AgentPermissions] resolveAskUser: ${requestId} not found in pending map`)
    return
  }
  pendingAskUser.delete(requestId)
  clearTimeout(pending.timeout)

  // Build answers map keyed by question text
  const questions = pending.originalInput.questions as Array<Record<string, unknown>> | undefined
  const firstQ = questions?.[0]
  const questionText = (firstQ?.question as string) || 'answer'
  const answers = { [questionText]: answer }

  try {
    pending.resolve({ behavior: 'allow', updatedInput: { ...pending.originalInput, answers } })
  } catch {
    // Subprocess may have already exited
  }
}

// ─── Bulk rejection (called on abort / window destroy) ─────────────────

export function rejectAllPendingPermissions(context?: AgentContext): void {
  for (const [id, p] of pendingPermissions) {
    if (context && p.context !== context) continue
    pendingPermissions.delete(id)
    clearTimeout(p.timeout)
    cancelPermissionNotification(id)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}

export function rejectAllPendingAskUser(context?: AgentContext): void {
  for (const [id, p] of pendingAskUser) {
    if (context && p.context !== context) continue
    pendingAskUser.delete(id)
    clearTimeout(p.timeout)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}
