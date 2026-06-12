import { useEffect, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import { emptySlot, type AgentStore } from '../store/agent-store'
import type { AgentContext } from '../../shared/types'
import type {
  AskUserRequestIPC,
  PermissionRequestIPC,
  SkillOutputState,
} from '../../shared/types'

const WATCHDOG_TIMEOUT = 120_000 // 2 minutes

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
      // Refresh watchdog for the context that received this event
      const ctx = msg.context as AgentContext | undefined
      if (ctx) refreshWatchdogByContext(ctx)
    })

    const unsubPerm = window.api.agent.onPermissionRequest((req) => {
      store.getState().handlePermissionRequest(req as PermissionRequestIPC)
      const ctx = (req as PermissionRequestIPC).context as AgentContext | undefined
      if (ctx) refreshWatchdogByContext(ctx)
    })

    const unsubAsk = window.api.agent.onAskUser((req) => {
      store.getState().handleAskUserRequest(req as AskUserRequestIPC)
      const ctx = (req as AskUserRequestIPC).context as AgentContext | undefined
      if (ctx) refreshWatchdogByContext(ctx)
    })

    const unsubAskTimeout = window.api.agent.onAskUserTimeout((data: { requestId: string; context: AgentContext }) => {
      store.getState().handleAskUserTimeout(data.requestId)
    })

    const unsubPermTimeout = window.api.agent.onPermissionTimeout((data: { requestId: string; context: AgentContext }) => {
      store.getState().handlePermissionTimeout(data.requestId)
    })

    const unsubSession = window.api.agent.onSessionCreated((data: { context: AgentContext; sessionId: string; workspacePath?: string }) => {
      // Capture the temp session ID BEFORE migration so we can clean it from sessionList
      const prevSessionId = store.getState().activeSessionId[data.context]
      const migratedTempId = prevSessionId?.startsWith('new-') ? prevSessionId : null
      // Capture the user-chosen title from sessionList before MATERIALIZE transforms the entry
      const tempTitle = migratedTempId
        ? store.getState().sessionList.find(s => s.id === migratedTempId)?.title
        : undefined

      // Only update activeSessionId if the user hasn't switched away to a
      // different session while this one was being created. Without this guard,
      // a session created in the background would hijack activeSessionId and
      // contaminate the editor slot with wrong-session data.
      //
      // prevSessionId === null means no session was active — this is the very
      // first session being created in the current context, so it IS the active
      // session and must receive the real sessionId.
      const isStillActiveSession =
        migratedTempId !== null ||               // temp session was active when send was triggered
        prevSessionId === data.sessionId ||       // resumed session matches current active
        prevSessionId === null                    // no active session yet (first session in context)

      store.setState((state) => {
        // If we have a temp session slot (from "新建对话"), migrate it to real session ID
        const nextSessionSlots = { ...state.sessionSlots }
        if (prevSessionId && prevSessionId.startsWith('new-') && !nextSessionSlots[data.sessionId]) {
          nextSessionSlots[data.sessionId] = {
            ...state.slots[data.context],
            currentSessionId: data.sessionId,
          }
          delete nextSessionSlots[prevSessionId]
        }

        if (isStillActiveSession) {
          // Normal path: this session is still what the user is viewing
          return {
            activeSessionId: { ...state.activeSessionId, [data.context]: data.sessionId },
            sessionSlots: nextSessionSlots,
            slots: {
              ...state.slots,
              [data.context]: {
                ...state.slots[data.context],
                currentSessionId: data.sessionId,
                workspacePath: data.workspacePath || state.slots[data.context].workspacePath,
              },
            },
          }
        } else {
          // Background session created — update slot cache and set the
          // context slot's currentSessionId so subsequent messages in this
          // context can reuse the same SDK session (prevents orphan sessions
          // and the "thinking" stuck state in AskZuovis).
          return {
            sessionSlots: nextSessionSlots,
            slots: {
              ...state.slots,
              [data.context]: {
                ...state.slots[data.context],
                currentSessionId: data.sessionId,
              },
            },
          }
        }
      })
      if (data.workspacePath && !store.getState().activeWorkspacePath) {
        store.setState({ activeWorkspacePath: data.workspacePath })
      }
      // Session list: if this is a temp→real migration, replace the temp
      // entry in-place. Otherwise (existing session got re-confirmed by SDK),
      // nothing to do — the session is already in the list from loadSessions
      // or a prior CREATE_TEMP+MATERIALIZE cycle.
      if (data.context === 'editor' && migratedTempId) {
        store.getState().dispatchSessionList({
          type: 'MATERIALIZE',
          tempId: migratedTempId,
          realId: data.sessionId,
        })
        // Rename the newly-materialized session with the user-chosen title.
        // Persist to BOTH the SDK (customTitle) and electron-store (survives restarts).
        if (tempTitle) {
          window.api.agent.renameSession(data.sessionId, tempTitle).catch(
            (err) => console.error('[useAgent] renameSession failed:', err)
          )
          window.api.agent.updateSessionRecord(data.sessionId, { title: tempTitle }).catch(() => {})
        }
        // Clean up the temp SessionRecord — the real one will be created
        // by addSessionRecord in query-runner.ts when the SDK assigns sessionId.
        window.api.agent.removeSessionRecord(migratedTempId).catch(() => {})
      }
      refreshWatchdogByContext(data.context)
    })

    const unsubSkillOutput = window.api.agent.onSkillOutput((state: SkillOutputState) => {
      store.getState().handleSkillOutput(state)
      const ctx = state.context as AgentContext | undefined
      if (ctx) refreshWatchdogByContext(ctx)
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

const watchdogTimers: Record<AgentContext, ReturnType<typeof setTimeout> | null> = { editor: null, ask: null }

function triggerWatchdog(ctx: AgentContext) {
  console.warn(`[Watchdog] agent stuck for 120s in ${ctx}, forcing abort`)
  window.api.agent.abort(ctx)
  useAgentStore.getState().dispatchAgentEvent({ type: 'ABORT' }, ctx)
  const s = useAgentStore.getState().slots[ctx]
  useAgentStore.setState((state) => ({
    slots: {
      ...state.slots,
      [ctx]: {
        ...state.slots[ctx],
        messages: [...s.messages, {
          kind: 'status' as const,
          id: `watchdog-${Date.now()}`,
          role: 'system',
          phase: 'complete',
          textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
          createdAt: Date.now(),
        }],
      },
    },
  }))
}

function refreshWatchdogByContext(ctx: AgentContext) {
  const timer = watchdogTimers[ctx]
  if (!timer) return
  clearTimeout(timer)
  watchdogTimers[ctx] = setTimeout(() => triggerWatchdog(ctx), WATCHDOG_TIMEOUT)
}

export function useAgent(context: AgentContext = 'editor') {
  const store = useAgentStore

  // ─── Watchdog: start / kill driven by agentState for this context ────────
  const agentState = store((s) => s.slots[context].agentState)

  useEffect(() => {
    if (isAgentActive(agentState)) {
      if (watchdogTimers[context]) clearTimeout(watchdogTimers[context])
      watchdogTimers[context] = setTimeout(() => triggerWatchdog(context), WATCHDOG_TIMEOUT)
    } else {
      if (watchdogTimers[context]) {
        clearTimeout(watchdogTimers[context])
        watchdogTimers[context] = null
      }
    }

    return () => {
      if (watchdogTimers[context]) {
        clearTimeout(watchdogTimers[context])
        watchdogTimers[context] = null
      }
    }
  }, [agentState, context, store])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (prompt: string, activeFilePath?: string) => {
    const state = store.getState()
    const slot = state.slots[context]
    const slotSid = slot.currentSessionId

    if (slot.agentState !== 'idle' && slot.agentState !== 'error') {
      state.dispatchAgentEvent({ type: 'ABORT' }, context)
      await window.api.agent.abort(slotSid || context)
    }

    // Re-validate context slot's session identity after the async yield.
    // If the slot was replaced (e.g. newSession during the await), abort.
    const currentState = store.getState()
    if (currentState.slots[context].currentSessionId !== slotSid) {
      return
    }

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
      const patch = {
        messages: [...s.slots[context].messages, {
          kind: 'user' as const,
          id: `user-${Date.now()}`,
          role: 'user',
          textContent: prompt.replace(/<!--FILE_CONVERT:.+?-->\n?/, ''),
          createdAt: Date.now(),
        }],
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
      // When the user switches from editor to AskZuovis, activeSessionId still
      // points to the editor's session — writing ask data there corrupts the
      // editor's cached slot.
      if (slotSid) {
        const cached = s.sessionSlots[slotSid]
        if (cached) {
          result.sessionSlots = {
            ...s.sessionSlots,
            [slotSid]: { ...cached, ...patch },
          }
        }
      }
      return result as Partial<AgentStore>
    })
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' }, context)
    const skillId = store.getState().slots[context].activeSkillId
    const workspacePath = context === 'ask' ? undefined : (store.getState().activeWorkspacePath || undefined)
    // Don't pass frontend-only temp IDs as SDK sessionId — the SDK doesn't
    // recognize them, would create an untracked duplicate session.
    const effectiveSid = slotSid?.startsWith('new-') ? undefined : (slotSid || undefined)
    window.api.agent.sendMessage(prompt, effectiveSid, activeFilePath, skillId || undefined, context, workspacePath)
  }, [context, store])

  const respondPermission = useCallback((requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => {
    store.getState().handlePermissionResponse(requestId, behavior)
    window.api.agent.respondPermission(requestId, behavior, options)
  }, [store])

  const respondAskUser = useCallback((requestId: string, answers: Record<string, string>) => {
    store.getState().handleAskUserResponse(requestId, answers)
    store.getState().dispatchAgentEvent({ type: 'ASK_USER_RESPONDED' }, context)
    window.api.agent.respondAskUser(requestId, answers)
  }, [context, store])

  const newSession = useCallback(() => {
    const state = store.getState()
    const slot = state.slots[context]
    // Abort running query for this context so the SDK subprocess doesn't
    // keep writing to a session we're about to detach from.
    if (slot.isStreaming) {
      state.dispatchAgentEvent({ type: 'ABORT' }, context)
      window.api.agent.abort(slot.currentSessionId || context).catch(() => {})
    }
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
      const sessions = await window.api.agent.listSdkSessions()
      store.getState().dispatchSessionList({
        type: 'REPLACE_SDK',
        sessions,
        workspacePath: undefined,
      })
    } catch (err) {
      console.error('[useAgent] Failed to load sessions:', err)
    }
  }, [store])

  const resumeSession = useCallback((sessionId: string) => {
    // switchToSession now handles SDK message load internally when _needsSdkLoad
    // is true, including isResumingSession flag management.
    store.getState().switchToSession(sessionId)
  }, [store])

  const loadMoreMessages = useCallback(async (sessionId: string) => {
    await store.getState().loadMoreSessionMessages(sessionId)
  }, [store])

  const hasMoreSdkMessages = store((s) => s.slots[context]._needsSdkLoad)

  const isLoadingMoreMessages = store((s) => s.slots[context]._isLoadingMoreMessages)

  const setPermissionMode = useCallback(async (mode: string) => {
    await window.api.agent.setPermissionMode(context, mode)
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
