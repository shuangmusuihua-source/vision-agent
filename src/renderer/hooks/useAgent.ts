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

    const unsubSession = window.api.agent.onSessionCreated((data: { context: AgentContext; sessionId: string }) => {
      store.setState((state) => ({
        slots: {
          ...state.slots,
          [data.context]: {
            ...state.slots[data.context],
            currentSessionId: data.sessionId,
          },
        },
      }))
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
          id: `watchdog-${Date.now()}`,
          role: 'system',
          phase: 'complete',
          textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
          content: [{ type: 'text', text: '☕ 等了很久没有回应，我先休息一下，有事随时沟通' }],
          toolCalls: [],
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
    if (slot.agentState !== 'idle' && slot.agentState !== 'error') {
      state.dispatchAgentEvent({ type: 'ABORT' }, context)
      await window.api.agent.abort(context)
    }
    store.setState((s) => ({
      slots: {
        ...s.slots,
        [context]: {
          ...s.slots[context],
          messages: [...s.slots[context].messages, {
            id: `user-${Date.now()}`,
            role: 'user',
            phase: 'complete',
            textContent: prompt,
            content: [{ type: 'text', text: prompt }],
            toolCalls: [],
            createdAt: Date.now(),
          }],
          isStreaming: true,
        },
      },
    }))
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' }, context)
    const skillId = store.getState().slots[context].activeSkillId
    window.api.agent.sendMessage(prompt, store.getState().slots[context].currentSessionId || undefined, activeFilePath, skillId || undefined, context)
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
      const sessions = await window.api.agent.listSdkSessions()
      store.setState({ sessionList: sessions })
    } catch (err) {
      console.error('[useAgent] Failed to load sessions:', err)
    }
  }, [store])

  const resumeSession = useCallback(async (sessionId: string) => {
    store.setState((s) => ({
      slots: {
        ...s.slots,
        [context]: {
          ...s.slots[context],
          isResumingSession: true,
        },
      },
    }))

    try {
      const messages = await window.api.agent.loadSessionMessages(sessionId)
      // Only clear the slot after successful load — preserve existing state on failure
      store.setState((s) => ({
        slots: {
          ...s.slots,
          [context]: {
            ...emptySlot(),
            currentSessionId: sessionId,
          },
        },
      }))
      for (const msg of messages) {
        store.getState().processIPCMessage(msg, { isReplay: true })
      }
    } catch (err) {
      console.error('[useAgent] Failed to resume session:', err)
    } finally {
      store.setState((s) => ({
        slots: {
          ...s.slots,
          [context]: {
            ...s.slots[context],
            isResumingSession: false,
          },
        },
      }))
    }
  }, [context, store])

  return {
    sendMessage,
    respondPermission,
    respondAskUser,
    newSession,
    loadSessions,
    resumeSession,
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
export const useAskUserRequest = (context: AgentContext) => useAgentStore((s) => s.slots[context].askUserRequest)
export const useSessionList = () => useAgentStore((s) => s.sessionList)
export const useLastEditedFile = (context: AgentContext) => useAgentStore((s) => s.slots[context].lastEditedFile)
export const useActiveSkillId = (context: AgentContext) => useAgentStore((s) => s.slots[context].activeSkillId)
export const useIsResumingSession = () => useAgentStore((s) => s.isResumingSession)
export const useSkillOutput = (context: AgentContext) => useAgentStore((s) => s.slots[context].skillOutput)