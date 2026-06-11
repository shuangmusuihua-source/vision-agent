import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentContext } from '../shared/types'
import { cancelPermissionNotification } from './notification-manager'

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
  sessionId?: string
}

interface PendingAskUser {
  resolve: (result: PermissionResult) => void
  originalInput: Record<string, unknown>
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
  sessionId?: string
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
  sessionId?: string,
): void {
  pendingPermissions.set(requestId, { resolve, input, timeout, context, sessionId })
}

export function registerPendingAskUser(
  requestId: string,
  resolve: (result: PermissionResult) => void,
  originalInput: Record<string, unknown>,
  timeout: ReturnType<typeof setTimeout>,
  context: AgentContext,
  sessionId?: string,
): void {
  pendingAskUser.set(requestId, { resolve, originalInput, timeout, context, sessionId })
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

export function resolvePermission(
  requestId: string,
  behavior: 'allow' | 'deny',
  options?: { updatedPermissions?: PermissionUpdate[]; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }
): void {
  const pending = pendingPermissions.get(requestId)
  if (!pending) return
  pendingPermissions.delete(requestId)
  clearTimeout(pending.timeout)
  cancelPermissionNotification(requestId)
  if (behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input,
      updatedPermissions: options?.updatedPermissions,
      decisionClassification: options?.decisionClassification ?? 'user_temporary',
    })
  } else {
    pending.resolve({
      behavior: 'deny',
      message: 'User denied permission',
      decisionClassification: options?.decisionClassification ?? 'user_reject',
    })
  }
}

export function resolveAskUser(requestId: string, answers: Record<string, string>): void {
  const pending = pendingAskUser.get(requestId)
  if (!pending) {
    console.warn(`[AgentPermissions] resolveAskUser: ${requestId} not found in pending map`)
    return
  }
  pendingAskUser.delete(requestId)
  clearTimeout(pending.timeout)

  try {
    pending.resolve({ behavior: 'allow', updatedInput: { ...pending.originalInput, answers } })
  } catch {
    // Subprocess may have already exited
  }
}

// ─── Bulk rejection (called on abort / window destroy) ─────────────────
// When queryKey is provided, only reject entries matching that key
// (either by sessionId or by context if no sessionId stored).

function matchesQueryKey(p: { context: AgentContext; sessionId?: string }, queryKey?: string): boolean {
  if (!queryKey) return true // abort all
  // Match by sessionId if it is set. If sessionId is set but does NOT match,
  // do NOT fall through to context matching — that would leak across sessions
  // (e.g., a queryKey of 'editor' would match permissions from a different
  // session that happens to share the same context).
  if (p.sessionId) return p.sessionId === queryKey
  // Only for entries without sessionId (legacy or pre-SDK-assignment):
  // match by context so they are still cleaned up on abort.
  return p.context === queryKey
}

/**
 * Update the sessionId on all pending entries that were registered with an
 * old queryKey (typically a context string like 'editor') before the SDK
 * assigned a real sessionId.  Called from query-runner when the first
 * message in a stream carries back the SDK-assigned session_id.
 */
export function updatePendingSessionId(oldQueryKey: string, newSessionId: string): void {
  for (const [id, p] of pendingPermissions) {
    if (p.sessionId === oldQueryKey) {
      pendingPermissions.set(id, { ...p, sessionId: newSessionId })
    }
  }
  for (const [id, p] of pendingAskUser) {
    if (p.sessionId === oldQueryKey) {
      pendingAskUser.set(id, { ...p, sessionId: newSessionId })
    }
  }
}

export function rejectAllPendingPermissions(queryKey?: string): void {
  for (const [id, p] of pendingPermissions) {
    if (!matchesQueryKey(p, queryKey)) continue
    pendingPermissions.delete(id)
    clearTimeout(p.timeout)
    cancelPermissionNotification(id)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}

export function rejectAllPendingAskUser(queryKey?: string): void {
  for (const [id, p] of pendingAskUser) {
    if (!matchesQueryKey(p, queryKey)) continue
    pendingAskUser.delete(id)
    clearTimeout(p.timeout)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}
