import { useEffect, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import { stripInternalAttachmentContext } from '../../shared/file-attachments'
import { getSkillInvocationDisplayText } from '../../shared/skill-invocation'
import {
  findAskUserTarget,
  resolveSessionSlot,
  selectAskUserRequest,
  selectIsResumingSession,
  selectPermissionQueueLength,
  selectPermissionRequest,
} from '../store/session-slot-state'
import type {
  AgentApprovalMode,
  AgentContext,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  PermissionRequestIPC,
  SessionRoutedRequestTimeout,
  SessionRoutedGenerationActivity,
} from '../../shared/types'

// This is an inactivity notice, not an execution deadline. A healthy tool can
// legitimately stay silent for minutes (for example a long Bash command), so
// renderer-side silence must never be used as proof that the SDK is stuck.
const WATCHDOG_NOTICE_TIMEOUT = 120_000

type ActiveAgentState = 'thinking' | 'running' | 'compacting'

const ACTIVE_STATES: Set<string> = new Set(['thinking', 'running', 'compacting'])

function isAgentActive(state: string): state is ActiveAgentState {
  return ACTIVE_STATES.has(state)
}

// ─── Singleton IPC subscription ────────────────────────────────────────
// MUST be called only once (in AppShell). Subscribes to all IPC channels
// and routes events to the correct store slot via msg.context.
// Calling useAgent('editor') + useAgent('ask') no longer duplicates subscriptions.

export function useIPCSubscriptions() {
  useEffect(() => {
    const store = useAgentStore

    const unsubEvent = window.api.agent.onEvent((msg) => {
      store.getState().processIPCMessage(msg, undefined)
      // Refresh watchdog for the concrete session that received this event.
      const ctx = msg.context as AgentContext | undefined
      if (ctx) refreshWatchdogAfterState(ctx, getEventSessionId(msg as Record<string, unknown>))
    })

    const unsubPerm = window.api.agent.onPermissionRequest((req) => {
      store.getState().handlePermissionRequest(req as PermissionRequestIPC)
      const ctx = (req as PermissionRequestIPC).context as AgentContext | undefined
      if (ctx) refreshWatchdogAfterState(ctx, getEventSessionId(req as unknown as Record<string, unknown>))
    })

    const unsubAsk = window.api.agent.onAskUser((req) => {
      store.getState().handleAskUserRequest(req as AskUserRequestIPC)
      const ctx = (req as AskUserRequestIPC).context as AgentContext | undefined
      if (ctx) refreshWatchdogAfterState(ctx, getEventSessionId(req as unknown as Record<string, unknown>))
    })

    const unsubAskTimeout = window.api.agent.onAskUserTimeout((data: SessionRoutedRequestTimeout) => {
      store.getState().handleAskUserTimeout(data.requestId)
    })

    const unsubPermTimeout = window.api.agent.onPermissionTimeout((data: SessionRoutedRequestTimeout) => {
      store.getState().handlePermissionTimeout(data.requestId)
    })

    const unsubSession = window.api.agent.onSessionCreated((data: AgentSessionEnvelope) => {
      // The creating query carries its app-owned session key. Do not infer it
      // from the currently active session; the user may have switched away
      // while the SDK was still creating the real session.
      const { clientSessionKey, sdkSessionId, sessionTitle } = store.getState().materializeSession(data)
      if (data.context === 'editor') {
        // Rename the newly materialized SDK session with the user-chosen title.
        // Persist to BOTH the SDK (customTitle) and electron-store (survives restarts).
        if (sessionTitle) {
          window.api.agent.renameSession(sdkSessionId, sessionTitle).catch(
            (err) => console.error('[useAgent] renameSession failed:', err)
          )
        }
      }
      refreshWatchdogAfterState(data.context, clientSessionKey)
    })

    const unsubGenerationActivity = window.api.agent.onGenerationActivity((state: SessionRoutedGenerationActivity) => {
      store.getState().handleGenerationActivity(state)
      const ctx = state.context as AgentContext | undefined
      if (ctx) refreshWatchdogAfterState(ctx, state.sessionId)
    })

    return () => {
      unsubEvent()
      unsubPerm()
      unsubAsk()
      unsubAskTimeout()
      unsubPermTimeout()
      unsubSession()
      unsubGenerationActivity()
    }
  }, [])
}

// ─── Watchdog registry (shared across hooks) ─────────────────────────────

type WatchdogEntry = {
  context: AgentContext
  sessionId: string | null
  timer: ReturnType<typeof setTimeout> | null
  noticeShown: boolean
}

const watchdogTimers = new Map<string, WatchdogEntry>()

function normalizeWatchdogSessionId(sessionId?: string | null): string | null {
  if (!sessionId || sessionId === 'editor' || sessionId === 'ask') return null
  return sessionId
}

function getEventSessionId(data: Record<string, unknown>): string | null {
  return normalizeWatchdogSessionId(
    (data.clientSessionKey as string | undefined)
    || (data.sessionId as string | undefined)
    || (data.session_id as string | undefined)
  )
}

function getWatchdogKey(ctx: AgentContext, sessionId?: string | null): string {
  return `${ctx}:${normalizeWatchdogSessionId(sessionId) || '__active__'}`
}

function getWatchdogSlot(ctx: AgentContext, sessionId?: string | null) {
  const state = useAgentStore.getState()
  const sid = normalizeWatchdogSessionId(sessionId)
  return resolveSessionSlot(state, ctx, sid)
}

function clearWatchdog(ctx: AgentContext, sessionId?: string | null) {
  const key = getWatchdogKey(ctx, sessionId)
  const entry = watchdogTimers.get(key)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  watchdogTimers.delete(key)
}

function appendWatchdogStatus(ctx: AgentContext, sessionId?: string | null) {
  useAgentStore.getState().appendInactivityNotice(ctx, sessionId)
}

function triggerWatchdog(ctx: AgentContext, sessionId?: string | null) {
  const sid = normalizeWatchdogSessionId(sessionId)
  const key = getWatchdogKey(ctx, sid)
  const entry = watchdogTimers.get(key)
  if (!entry || !isAgentActive(getWatchdogSlot(ctx, sid).agentState)) {
    clearWatchdog(ctx, sid)
    return
  }

  // Keep the task alive. IPC inactivity alone cannot distinguish a hung run
  // from a healthy long-running tool. Show one notice per run and leave the
  // explicit stop control to the user.
  entry.timer = null
  entry.noticeShown = true
  console.warn(`[Watchdog] no agent progress for 120s in ${ctx}${sid ? ` session ${sid}` : ''}; task remains active`)
  appendWatchdogStatus(ctx, sid)
}

function refreshWatchdog(ctx: AgentContext, sessionId?: string | null) {
  const sid = normalizeWatchdogSessionId(sessionId)
  const slot = getWatchdogSlot(ctx, sid)
  const effectiveSid = sid || normalizeWatchdogSessionId(slot.currentSessionId)
  const key = getWatchdogKey(ctx, effectiveSid)
  const existing = watchdogTimers.get(key)

  if (!isAgentActive(slot.agentState)) {
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer)
      watchdogTimers.delete(key)
    }
    return
  }

  // Avoid repeating the notice every two minutes during one long run.
  if (existing?.noticeShown) return
  if (existing?.timer) clearTimeout(existing.timer)
  watchdogTimers.set(key, {
    context: ctx,
    sessionId: effectiveSid,
    timer: setTimeout(() => triggerWatchdog(ctx, effectiveSid), WATCHDOG_NOTICE_TIMEOUT),
    noticeShown: false,
  })
}

function refreshWatchdogAfterState(ctx: AgentContext, sessionId?: string | null) {
  refreshWatchdog(ctx, sessionId)
  setTimeout(() => refreshWatchdog(ctx, sessionId), 0)
}

export function useAgent(context: AgentContext = 'editor') {
  const store = useAgentStore

  // ─── Watchdog: start / kill driven by agentState for this session ────────
  const agentState = store((s) => s.slots[context].agentState)
  const currentSessionId = store((s) => s.slots[context].currentSessionId)

  useEffect(() => {
    refreshWatchdog(context, currentSessionId)
  }, [agentState, currentSessionId, context])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (
    prompt: string,
    activeFilePath?: string,
    options?: { skill?: { id: string; name: string; icon: string } },
  ) => {
    const state = store.getState()
    const slot = state.slots[context]
    let slotSid = slot.currentSessionId

    if (slot.agentState !== 'idle' && slot.agentState !== 'error') {
      state.dispatchAgentEvent({ type: 'ABORT' }, context, slotSid)
      await window.api.agent.abort(slotSid || context)
    }

    // Re-validate context slot's session identity after the async yield.
    // If the slot was replaced (e.g. newSession during the await), abort.
    const currentState = store.getState()
    if (currentState.slots[context].currentSessionId !== slotSid) {
      return
    }

    const visibleText = options?.skill
      ? `执行 Skill: ${options.skill.name}`
      : (getSkillInvocationDisplayText(prompt) || stripInternalAttachmentContext(prompt))
    slotSid = store.getState().beginMessage(context, visibleText, options?.skill)
    const clientSessionKey = slotSid

    // A new query starts a new inactivity window, even when it reuses the
    // same session after replacing an active run.
    clearWatchdog(context, clientSessionKey)

    // The store owns the optimistic message and live/cache mirroring.
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' }, context, slotSid)
    refreshWatchdog(context, slotSid)
    const skillId = store.getState().slots[context].activeSkillId
    // Don't pass frontend-only temp IDs as SDK sessionId — the SDK doesn't
    // recognize them, would create an untracked duplicate session.
    const currentSlot = resolveSessionSlot(store.getState(), context, slotSid)
    const workspacePath = context === 'ask'
      ? undefined
      : (currentSlot.workspacePath || store.getState().activeWorkspacePath || undefined)
    const effectiveSid = currentSlot.sdkSessionId || (slotSid?.startsWith('new-') ? undefined : (slotSid || undefined))
    const sessionTitle = slotSid
      ? store.getState().sessionList.find((session) => session.id === slotSid)?.title
      : undefined
    window.api.agent.sendMessage(
      prompt,
      effectiveSid,
      activeFilePath,
      skillId || undefined,
      context,
      workspacePath,
      sessionTitle,
      clientSessionKey,
      currentSlot.approvalMode,
    )
  }, [context, store])

  const respondPermission = useCallback((requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => {
    store.getState().handlePermissionResponse(requestId, behavior)
    window.api.agent.respondPermission(requestId, behavior, options)
  }, [store])

  const respondAskUser = useCallback((requestId: string, answers: Record<string, string>) => {
    const target = findAskUserTarget(store.getState(), requestId, context)
    store.getState().handleAskUserResponse(requestId, answers)
    if (target) {
      store.getState().dispatchAgentEvent({ type: 'ASK_USER_RESPONDED' }, target.context, target.sessionId)
      refreshWatchdogAfterState(target.context, target.sessionId)
    }
    window.api.agent.respondAskUser(requestId, answers)
  }, [context, store])

  const newSession = useCallback(() => {
    store.getState().startNewSession(context)
  }, [context, store])

  const loadSessions = useCallback(async () => {
    try {
      const workspacePath = store.getState().activeWorkspacePath || undefined
      const sessions = await window.api.agent.listSdkSessions(workspacePath)
      store.getState().dispatchSessionList({
        type: 'REPLACE_SDK',
        sessions,
        workspacePath,
      })
    } catch (err) {
      console.error('[useAgent] Failed to load sessions:', err)
    }
  }, [store])

  const resumeSession = useCallback((sessionId: string) => {
    // switchToSession starts the slot-scoped SDK history load when needed.
    store.getState().switchToSession(sessionId, context)
  }, [context, store])

  const loadMoreMessages = useCallback(async (sessionId: string) => {
    await store.getState().loadMoreSessionMessages(sessionId)
  }, [store])

  const hasMoreSdkMessages = store((s) => s.slots[context]._needsSdkLoad)

  const isLoadingMoreMessages = store((s) => s.slots[context]._isLoadingMoreMessages)

  const setPermissionMode = useCallback(async (mode: AgentApprovalMode) => {
    const currentSlot = store.getState().slots[context]
    const previousMode = currentSlot.approvalMode
    const queryKey = currentSlot.currentSessionId || context
    store.getState().setApprovalMode(context, mode, currentSlot.currentSessionId)

    if (!currentSlot.isStreaming) return { success: true }

    const result = await window.api.agent.setPermissionMode(queryKey, mode)
    if (!result.success) {
      console.warn('[useAgent] Failed to set permission mode:', result.error)
      store.getState().setApprovalMode(context, previousMode, currentSlot.currentSessionId)
    }
    return result
  }, [context, store])

  return {
    sendMessage,
    respondPermission,
    respondAskUser,
    newSession,
    loadSessions,
    resumeSession,
    loadMoreMessages,
    hasMoreSdkMessages,
    isLoadingMoreMessages,
    setPermissionMode,
  }
}

// ─── Context-aware Selectors ────────────────────────────────────────────

export const useMessages = (context: AgentContext) => useAgentStore((s) => s.slots[context].messages)
export const useIsStreaming = (context: AgentContext) => useAgentStore((s) => s.slots[context].isStreaming)
export const useCurrentSessionId = (context: AgentContext) => useAgentStore((s) => s.slots[context].currentSessionId)
export const useAgentStatus = (context: AgentContext) => useAgentStore((s) => s.slots[context].agentState)
// Permission / AskUser selectors — live-slot priority, per-context session.
//
// The live slot (slots[context]) is the source of truth when the context's
// session is active.  handlePermissionRequest writes there when the request
// belongs to the context's current session.  Fall back to sessionSlots for
// the context's own sessionId — NOT global activeSessionId which conflates
// editor and ask contexts.
export const usePermissionRequest = (context: AgentContext) =>
  useAgentStore((state) => selectPermissionRequest(state, context))
export const usePermissionQueueLength = (context: AgentContext) =>
  useAgentStore((state) => selectPermissionQueueLength(state, context))
export const useAskUserRequest = (context: AgentContext) =>
  useAgentStore((state) => selectAskUserRequest(state, context))
export const useSessionList = () => useAgentStore((s) => s.sessionList)
export const useTtftMs = (context: AgentContext) => useAgentStore((s) => s.slots[context].ttftMs)
export const useActiveSkillId = (context: AgentContext) => useAgentStore((s) => s.slots[context].activeSkillId)
export const useIsResumingSession = (context: AgentContext) =>
  useAgentStore((state) => selectIsResumingSession(state, context))
export const useGenerationActivity = (context: AgentContext) => useAgentStore((s) => s.slots[context].generationActivity)
