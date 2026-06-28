import { useEffect, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import { stripInternalAttachmentContext } from '../../shared/file-attachments'
import { getSkillInvocationDisplayText } from '../../shared/skill-invocation'
import { emptySlot, type AgentStore } from '../store/agent-store'
import type {
  AgentContext,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  ConversationMessage,
  PermissionRequestIPC,
  SessionRoutedRequestTimeout,
  SessionRoutedSkillOutputState,
} from '../../shared/types'

const WATCHDOG_TIMEOUT = 120_000 // 2 minutes

type ActiveAgentState = 'thinking' | 'running' | 'compacting'

const ACTIVE_STATES: Set<string> = new Set(['thinking', 'running', 'compacting'])

function isAgentActive(state: string): state is ActiveAgentState {
  return ACTIVE_STATES.has(state)
}

function mergeMessages(...groups: ConversationMessage[][]): ConversationMessage[] {
  const seen = new Set<string>()
  const merged: ConversationMessage[] = []
  for (const group of groups) {
    for (const message of group) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      merged.push(message)
    }
  }
  return merged
}

function mergeById<T extends { id: string }>(items: Array<T | null | undefined>): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
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
      const clientSessionKey = data.clientSessionKey || data.sessionId
      const sdkSessionId = data.sdkSessionId || data.sessionId
      const sessionTitle = store.getState().sessionList.find(s => s.id === clientSessionKey)?.title

      store.setState((state) => {
        const nextSessionSlots = { ...state.sessionSlots }
        const currentActiveId = state.activeSessionId[data.context]
        const clientSlot = nextSessionSlots[clientSessionKey]
        const sdkSlot = clientSessionKey !== sdkSessionId ? nextSessionSlots[sdkSessionId] : undefined
        const activeSlotIsClient = currentActiveId === clientSessionKey || currentActiveId === sdkSessionId
        const sourceSlot = clientSlot || (activeSlotIsClient ? state.slots[data.context] : undefined)
        const realSlot = sdkSlot
        const baseSlot = sourceSlot || realSlot || emptySlot()
        const permissionItems = mergeById<PermissionRequestIPC>([
          sourceSlot?.permissionRequest,
          ...(sourceSlot?.permissionQueue || []),
          realSlot?.permissionRequest,
          ...(realSlot?.permissionQueue || []),
        ])
        const askUserItems = mergeById<AskUserRequestIPC>([
          sourceSlot?.askUserRequest,
          ...(sourceSlot?.askUserQueue || []),
          realSlot?.askUserRequest,
          ...(realSlot?.askUserQueue || []),
        ])
        const materializedSlot = {
          ...(sourceSlot || {}),
          ...(realSlot || {}),
          messages: mergeMessages(sourceSlot?.messages || [], realSlot?.messages || []),
          isStreaming: Boolean(sourceSlot?.isStreaming || realSlot?.isStreaming),
          agentState: realSlot?.agentState && realSlot.agentState !== 'idle'
            ? realSlot.agentState
            : (sourceSlot?.agentState || baseSlot.agentState),
          _acc: realSlot?._acc || sourceSlot?._acc || null,
          _firstContentSeen: Boolean(realSlot?._firstContentSeen || sourceSlot?._firstContentSeen),
          _processedArtifactIds: new Set([
            ...(sourceSlot?._processedArtifactIds || []),
            ...(realSlot?._processedArtifactIds || []),
          ]),
          _queryGeneration: Math.max(sourceSlot?._queryGeneration || 0, realSlot?._queryGeneration || 0),
          _resultGuardGen: Math.max(sourceSlot?._resultGuardGen || 0, realSlot?._resultGuardGen || 0),
          permissionRequest: permissionItems[0] || null,
          permissionQueue: permissionItems.slice(1),
          askUserRequest: askUserItems[0] || null,
          askUserQueue: askUserItems.slice(1),
          skillOutput: realSlot?.skillOutput || sourceSlot?.skillOutput || null,
          activeSkillId: realSlot?.activeSkillId || sourceSlot?.activeSkillId || null,
          lastEditedFile: realSlot?.lastEditedFile || sourceSlot?.lastEditedFile || null,
          usageInfo: realSlot?.usageInfo || sourceSlot?.usageInfo || null,
          todoList: realSlot?.todoList || sourceSlot?.todoList || null,
          currentSessionId: clientSessionKey,
          sdkSessionId,
          workspacePath: data.workspacePath || sourceSlot?.workspacePath || realSlot?.workspacePath || null,
        }

        nextSessionSlots[clientSessionKey] = materializedSlot
        if (sdkSessionId !== clientSessionKey) {
          delete nextSessionSlots[sdkSessionId]
        }

        const accessOrder = state.sessionAccessOrder
          .filter((id) => id !== clientSessionKey && id !== sdkSessionId)
        accessOrder.push(clientSessionKey)

        const isStillActiveSession =
          currentActiveId === clientSessionKey ||
          currentActiveId === sdkSessionId ||
          currentActiveId === null

        if (isStillActiveSession) {
          return {
            activeSessionId: { ...state.activeSessionId, [data.context]: clientSessionKey },
            sessionSlots: nextSessionSlots,
            sessionAccessOrder: accessOrder,
            slots: {
              ...state.slots,
              [data.context]: materializedSlot,
            },
          }
        }
        return { sessionSlots: nextSessionSlots, sessionAccessOrder: accessOrder }
      })
      if (data.context === 'editor' && data.workspacePath && !store.getState().activeWorkspacePath) {
        store.setState({ activeWorkspacePath: data.workspacePath })
      }
      // Session list stores app-owned ids. Materialization attaches the SDK
      // id but never renames the user-facing session.
      if (data.context === 'editor') {
        store.getState().dispatchSessionList({
          type: 'MATERIALIZE',
          tempId: clientSessionKey,
          realId: sdkSessionId,
          context: data.context,
          workspacePath: data.workspacePath,
          title: sessionTitle,
        })
        // Rename the newly materialized SDK session with the user-chosen title.
        // Persist to BOTH the SDK (customTitle) and electron-store (survives restarts).
        if (sessionTitle) {
          window.api.agent.renameSession(sdkSessionId, sessionTitle).catch(
            (err) => console.error('[useAgent] renameSession failed:', err)
          )
          window.api.agent.updateSessionRecord(clientSessionKey, {
            title: sessionTitle,
            sdkSessionId,
            workspacePath: data.workspacePath,
            context: data.context,
            status: 'active',
            lastModified: Date.now(),
          }).catch(() => {})
        }
      }
      refreshWatchdogAfterState(data.context, clientSessionKey)
    })

    const unsubSkillOutput = window.api.agent.onSkillOutput((state: SessionRoutedSkillOutputState) => {
      store.getState().handleSkillOutput(state)
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
      unsubSkillOutput()
    }
  }, [])
}

// ─── Watchdog registry (shared across hooks) ─────────────────────────────

type WatchdogEntry = {
  context: AgentContext
  sessionId: string | null
  timer: ReturnType<typeof setTimeout>
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
  if (sid && state.sessionSlots[sid]) return state.sessionSlots[sid]
  return state.slots[ctx]
}

function clearWatchdog(ctx: AgentContext, sessionId?: string | null) {
  const key = getWatchdogKey(ctx, sessionId)
  const entry = watchdogTimers.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  watchdogTimers.delete(key)
}

function appendWatchdogStatus(ctx: AgentContext, sessionId?: string | null) {
  const sid = normalizeWatchdogSessionId(sessionId)
  useAgentStore.setState((state) => {
    const target = sid && state.sessionSlots[sid]
      ? state.sessionSlots[sid]
      : state.slots[ctx]
    const nextSlot = {
      ...target,
      messages: [...target.messages, {
        kind: 'status' as const,
        id: `watchdog-${Date.now()}`,
        role: 'system' as const,
        phase: 'complete' as const,
        textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
        createdAt: Date.now(),
      }],
    }
    if (sid) {
      return {
        sessionSlots: { ...state.sessionSlots, [sid]: nextSlot },
        ...(state.activeSessionId[ctx] === sid
          ? { slots: { ...state.slots, [ctx]: nextSlot } }
          : {}),
      }
    }
    return {
      slots: { ...state.slots, [ctx]: nextSlot },
    }
  })
}

function triggerWatchdog(ctx: AgentContext, sessionId?: string | null) {
  const sid = normalizeWatchdogSessionId(sessionId)
  clearWatchdog(ctx, sid)
  console.warn(`[Watchdog] agent stuck for 120s in ${ctx}${sid ? ` session ${sid}` : ''}, forcing abort`)
  window.api.agent.abort(sid || ctx)
  useAgentStore.getState().dispatchAgentEvent({ type: 'ABORT' }, ctx, sid)
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
      clearTimeout(existing.timer)
      watchdogTimers.delete(key)
    }
    return
  }

  if (existing) clearTimeout(existing.timer)
  watchdogTimers.set(key, {
    context: ctx,
    sessionId: effectiveSid,
    timer: setTimeout(() => triggerWatchdog(ctx, effectiveSid), WATCHDOG_TIMEOUT),
  })
}

function refreshWatchdogAfterState(ctx: AgentContext, sessionId?: string | null) {
  refreshWatchdog(ctx, sessionId)
  setTimeout(() => refreshWatchdog(ctx, sessionId), 0)
}

function findAskUserTarget(
  state: AgentStore,
  requestId: string,
  fallbackContext: AgentContext
): { context: AgentContext; sessionId: string | null } | null {
  for (const ctx of ['ask', 'editor'] as AgentContext[]) {
    const slot = state.slots[ctx]
    const req = slot.askUserRequest
    if (req?.id === requestId) {
      return {
        context: ctx,
        sessionId: req.sessionId || slot.currentSessionId || state.activeSessionId[ctx],
      }
    }
    const queued = slot.askUserQueue.find((item) => item.id === requestId)
    if (queued) {
      return {
        context: ctx,
        sessionId: queued.sessionId || slot.currentSessionId || state.activeSessionId[ctx],
      }
    }
  }

  for (const [sid, slot] of Object.entries(state.sessionSlots)) {
    const req = slot.askUserRequest
    if (req?.id === requestId) {
      return { context: req.context || fallbackContext, sessionId: req.sessionId || sid }
    }
    const queued = slot.askUserQueue.find((item) => item.id === requestId)
    if (queued) {
      return { context: queued.context || fallbackContext, sessionId: queued.sessionId || sid }
    }
  }

  return null
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

    if (!slotSid) {
      const tempKey = `new-${context}-${Date.now()}`
      slotSid = tempKey
      store.setState((s) => {
        const preparedSlot = {
          ...s.slots[context],
          currentSessionId: tempKey,
          sdkSessionId: null,
        }
        const accessOrder = s.sessionAccessOrder.filter((id) => id !== tempKey)
        accessOrder.push(tempKey)
        return {
          activeSessionId: { ...s.activeSessionId, [context]: tempKey },
          sessionSlots: { ...s.sessionSlots, [tempKey]: preparedSlot },
          sessionAccessOrder: accessOrder,
          slots: { ...s.slots, [context]: preparedSlot },
        }
      })
    }
    const clientSessionKey = slotSid

    // Optimistic write: insert the user message directly into the messages array
    // before the SDK processes it. The SDK will later send back a 'user' IPC event
    // (routed through processIPCMessage → handleUserMessage) which processes
    // associated tool results. During live operation handleUserMessage skips
    // re-adding the user message (it only does so on replay with dedup), so this
    // optimistic insert is the canonical source for user messages during live sessions.
    //
    // Mirror to the context's session slot so the optimistic message
    // survives a session switch → switch back cycle.
    store.setState((s) => {
      const visibleText = options?.skill
        ? `执行 Skill: ${options.skill.name}`
        : (getSkillInvocationDisplayText(prompt) || stripInternalAttachmentContext(prompt))
      const patch = {
        messages: [...s.slots[context].messages, {
          kind: 'user' as const,
          id: `user-${Date.now()}`,
          role: 'user',
          textContent: visibleText,
          ...(options?.skill ? {
            skillMeta: {
              id: options.skill.id,
              name: options.skill.name,
              icon: options.skill.icon,
              status: 'running' as const,
            },
          } : {}),
          createdAt: Date.now(),
        }],
        ...(options?.skill ? { activeSkillId: options.skill.id } : {}),
        isStreaming: true,
      }
      const result: Record<string, unknown> = {
        slots: {
          ...s.slots,
          [context]: { ...s.slots[context], ...patch },
        },
      }
      // Mirror to session-scoped cache so the message persists across switches.
      // Use the context's own sessionId (slotSid), NOT activeSessionId because
      // activeSessionId is a global singleton shared by editor + ask contexts.
      // When the user switches from editor to Ask sumi, activeSessionId still
      // points to the editor's session — writing ask data there corrupts the
      // editor's cached slot.
      if (slotSid) {
        const cached = s.sessionSlots[slotSid] || s.slots[context]
        result.sessionSlots = {
          ...s.sessionSlots,
          [slotSid]: { ...cached, ...patch, currentSessionId: slotSid },
        }
      }
      return result as Partial<AgentStore>
    })
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' }, context, slotSid)
    refreshWatchdog(context, slotSid)
    const skillId = store.getState().slots[context].activeSkillId
    // Don't pass frontend-only temp IDs as SDK sessionId — the SDK doesn't
    // recognize them, would create an untracked duplicate session.
    const currentSlot = store.getState().sessionSlots[slotSid] || store.getState().slots[context]
    const workspacePath = context === 'ask'
      ? undefined
      : (currentSlot.workspacePath || store.getState().activeWorkspacePath || undefined)
    const effectiveSid = currentSlot.sdkSessionId || (slotSid?.startsWith('new-') ? undefined : (slotSid || undefined))
    const sessionTitle = slotSid
      ? store.getState().sessionList.find((session) => session.id === slotSid)?.title
      : undefined
    window.api.agent.sendMessage(prompt, effectiveSid, activeFilePath, skillId || undefined, context, workspacePath, sessionTitle, clientSessionKey)
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
    const state = store.getState()
    const slot = state.slots[context]
    // Save current slot to sessionSlots before clearing, so the old
    // session's messages are not lost if the user navigates back.
    // Prefer the context slot's own sessionId.
    const saveSid = slot.currentSessionId || state.activeSessionId[context]
    store.setState((s) => {
      const nextSessionSlots = { ...s.sessionSlots }
      if (saveSid) {
        nextSessionSlots[saveSid] = { ...s.slots[context] }
      }
      return {
        activeSessionId: { ...s.activeSessionId, [context]: null },
        sessionOutputs: null,
        sessionOutputsLoading: false,
        sessionSlots: nextSessionSlots,
        slots: {
          ...s.slots,
          [context]: { ...emptySlot(), workspacePath: s.slots[context].workspacePath },
        },
      }
    })
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
    // switchToSession now handles SDK message load internally when _needsSdkLoad
    // is true, including isResumingSession flag management.
    store.getState().switchToSession(sessionId, context)
  }, [context, store])

  const loadMoreMessages = useCallback(async (sessionId: string) => {
    await store.getState().loadMoreSessionMessages(sessionId)
  }, [store])

  const hasMoreSdkMessages = store((s) => s.slots[context]._needsSdkLoad)

  const isLoadingMoreMessages = store((s) => s.slots[context]._isLoadingMoreMessages)

  const setPermissionMode = useCallback(async (mode: string) => {
    const result = await window.api.agent.setPermissionMode(context, mode)
    if (!result.success) {
      console.warn('[useAgent] Failed to set permission mode:', result.error)
    }
    return result
  }, [context])

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

export const useSlot = (context: AgentContext) => useAgentStore((s) => s.slots[context])
export const useMessages = (context: AgentContext) => useAgentStore((s) => s.slots[context].messages)
export const useIsStreaming = (context: AgentContext) => useAgentStore((s) => s.slots[context].isStreaming)
export const useCurrentSessionId = (context: AgentContext) => useAgentStore((s) => s.slots[context].currentSessionId)
export const useAgentStatus = (context: AgentContext) => useAgentStore((s) => s.slots[context].agentState)
export const useUsageInfo = (context: AgentContext) => useAgentStore((s) => s.slots[context].usageInfo)
// Permission / AskUser selectors — live-slot priority, per-context session.
//
// The live slot (slots[context]) is the source of truth when the context's
// session is active.  handlePermissionRequest writes there when the request
// belongs to the context's current session.  Fall back to sessionSlots for
// the context's own sessionId — NOT global activeSessionId which conflates
// editor and ask contexts.
export const usePermissionRequest = (context: AgentContext) => useAgentStore((s) => {
  const live = s.slots[context].permissionRequest
  if (live) return live
  const slotSid = s.slots[context]?.currentSessionId
  if (slotSid && s.sessionSlots[slotSid]?.permissionRequest) return s.sessionSlots[slotSid].permissionRequest
  return null
})
export const usePermissionQueueLength = (context: AgentContext) => useAgentStore((s) => {
  const live = s.slots[context].permissionQueue.length
  if (live > 0) return live
  const slotSid = s.slots[context]?.currentSessionId
  if (slotSid && s.sessionSlots[slotSid]) return s.sessionSlots[slotSid].permissionQueue.length
  return 0
})
export const useAskUserRequest = (context: AgentContext) => useAgentStore((s) => {
  const live = s.slots[context].askUserRequest
  if (live) return live
  const slotSid = s.slots[context]?.currentSessionId
  if (slotSid && s.sessionSlots[slotSid]?.askUserRequest) return s.sessionSlots[slotSid].askUserRequest
  return null
})
export const useSessionList = () => useAgentStore((s) => s.sessionList)
export const useLastEditedFile = (context: AgentContext) => useAgentStore((s) => s.slots[context].lastEditedFile)
export const useTtftMs = (context: AgentContext) => useAgentStore((s) => s.slots[context].ttftMs)
export const useActiveSkillId = (context: AgentContext) => useAgentStore((s) => s.slots[context].activeSkillId)
export const useIsResumingSession = () => useAgentStore((s) => s.isResumingSession)
export const useSkillOutput = (context: AgentContext) => useAgentStore((s) => s.slots[context].skillOutput)
export const useHasMoreSdkMessages = (context: AgentContext) =>
  useAgentStore((s) => s.slots[context]._needsSdkLoad)
export const useIsLoadingMoreMessages = (context: AgentContext) =>
  useAgentStore((s) => s.slots[context]._isLoadingMoreMessages)
