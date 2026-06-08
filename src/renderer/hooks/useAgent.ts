import { useEffect, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import { emptySlot } from '../store/agent-store'
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
      const prevSessionId = store.getState().activeSessionId
      const migratedTempId = prevSessionId?.startsWith('new-') ? prevSessionId : null
      // Capture the user-chosen title from sessionList before MATERIALIZE transforms the entry
      const tempTitle = migratedTempId
        ? store.getState().sessionList.find(s => s.id === migratedTempId)?.title
        : undefined

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

        return {
          activeSessionId: data.sessionId,
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
        // Fire-and-forget: rename the SDK session with the user-chosen title
        if (tempTitle) {
          window.api.agent.renameSession(data.sessionId, tempTitle).catch(
            (err) => console.error('[useAgent] renameSession failed:', err)
          )
        }
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
    // Optimistic write: insert the user message directly into the messages array
    // before the SDK processes it. The SDK will later send back a 'user' IPC event
    // (routed through processIPCMessage → handleUserMessage) which processes
    // associated tool results. During live operation handleUserMessage skips
    // re-adding the user message (it only does so on replay with dedup), so this
    // optimistic insert is the canonical source for user messages during live sessions.
    store.setState((s) => ({
      slots: {
        ...s.slots,
        [context]: {
          ...s.slots[context],
          messages: [...s.slots[context].messages, {
            kind: 'user' as const,
            id: `user-${Date.now()}`,
            role: 'user',
            textContent: prompt.replace(/<!--FILE_CONVERT:.+?-->\n?/, ''),
            createdAt: Date.now(),
          }],
          isStreaming: true,
        },
      },
    }))
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' }, context)
    const skillId = store.getState().slots[context].activeSkillId
    const workspacePath = context === 'ask' ? undefined : (store.getState().activeWorkspacePath || undefined)
    // Don't pass frontend-only temp IDs as SDK sessionId — the SDK doesn't
    // recognize them, would create an untracked duplicate session.
    const effectiveSid = slotSid?.startsWith('new-') ? undefined : (slotSid || undefined)
    window.api.agent.sendMessage(prompt, effectiveSid, activeFilePath, skillId || undefined, context, workspacePath)
  }, [context, store])

  const respondPermission = useCallback((requestId: string, behavior: 'allow' | 'deny') => {
    store.getState().handlePermissionResponse(requestId, behavior)
    window.api.agent.respondPermission(requestId, behavior)
  }, [store])

  const respondAskUser = useCallback((requestId: string, answer: string) => {
    store.getState().handleAskUserResponse(requestId, answer)
    store.getState().dispatchAgentEvent({ type: 'ASK_USER_RESPONDED' }, context)
    window.api.agent.respondAskUser(requestId, answer)
  }, [context, store])

  const newSession = useCallback(() => {
    store.setState((s) => ({
      slots: {
        ...s.slots,
        [context]: emptySlot(),
      },
    }))
  }, [context, store])

  const loadSessions = useCallback(async () => {
    try {
      const workspacePath = store.getState().activeWorkspacePath || undefined
      const sessions = await window.api.agent.listSdkSessions(workspacePath)
      // Guard: if workspace changed while loading, discard stale result.
      if (workspacePath !== (store.getState().activeWorkspacePath || undefined)) {
        return
      }
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
    store.getState().switchToSession(sessionId)
  }, [store])

  const loadMoreMessages = useCallback(async (sessionId: string) => {
    await store.getState().loadMoreSessionMessages(sessionId)
  }, [store])

  const hasMoreSdkMessages = store((s) => {
    const slot = s.slots[context]
    return slot._sdkLoadOffset < slot._sdkLoadedCount
  })

  const isLoadingMoreMessages = store((s) => s.slots[context]._isLoadingMoreMessages)

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
  }
}

// ─── Context-aware Selectors ────────────────────────────────────────────

export const useSlot = (context: AgentContext) => useAgentStore((s) => s.slots[context])
export const useMessages = (context: AgentContext) => useAgentStore((s) => s.slots[context].messages)
export const useIsStreaming = (context: AgentContext) => useAgentStore((s) => s.slots[context].isStreaming)
export const useCurrentSessionId = (context: AgentContext) => useAgentStore((s) => s.slots[context].currentSessionId)
export const useAgentStatus = (context: AgentContext) => useAgentStore((s) => s.slots[context].agentState)
export const useUsageInfo = (context: AgentContext) => useAgentStore((s) => s.slots[context].usageInfo)
export const usePermissionRequest = (context: AgentContext) => useAgentStore((s) => s.slots[context].permissionRequest)
export const usePermissionQueueLength = (context: AgentContext) => useAgentStore((s) => s.slots[context].permissionQueue.length)
export const useAskUserRequest = (context: AgentContext) => useAgentStore((s) => s.slots[context].askUserRequest)
export const useSessionList = () => useAgentStore((s) => s.sessionList)
export const useLastEditedFile = (context: AgentContext) => useAgentStore((s) => s.slots[context].lastEditedFile)
export const useActiveSkillId = (context: AgentContext) => useAgentStore((s) => s.slots[context].activeSkillId)
export const useIsResumingSession = () => useAgentStore((s) => s.isResumingSession)
export const useSkillOutput = (context: AgentContext) => useAgentStore((s) => s.slots[context].skillOutput)
export const useHasMoreSdkMessages = (context: AgentContext) =>
  useAgentStore((s) => {
    const slot = s.slots[context]
    return slot._sdkLoadOffset < slot._sdkLoadedCount
  })
export const useIsLoadingMoreMessages = (context: AgentContext) =>
  useAgentStore((s) => s.slots[context]._isLoadingMoreMessages)
