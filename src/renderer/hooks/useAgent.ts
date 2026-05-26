import { useEffect, useRef, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import type {
  AgentIPCMessage,
  AssistantPayload,
  StreamEventPayloadIPC,
  StreamContentBlockDelta,
  StreamContentBlockStart,
  TextDelta,
  InputJsonDelta,
  UserPayload,
  ResultSuccessPayload,
  ResultErrorPayload,
  SystemInitPayload,
  SystemStatusPayload,
  SystemCompactBoundaryPayload,
  SystemPermissionDeniedPayload,
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

/**
 * useAgent — thin IPC subscription layer with watchdog timer.
 *
 * All message processing logic lives in the store (processIPCMessage).
 * This hook's only job:
 *   1. Subscribe to IPC events on mount
 *   2. Forward typed messages to store.processIPCMessage
 *   3. Manage watchdog lifecycle driven by agentState
 *   4. Expose concise action functions for UI components
 *
 * Watchdog lifecycle:
 *   - Start/restart: when agentState enters an active state (thinking/running/compacting)
 *   - Kill:         when agentState enters a terminal state (idle/error/waitingForUserInput)
 *   - Refresh:      on each IPC event while active (resets the countdown)
 *   No IPC event can start a watchdog — only the state transition does.
 */
export function useAgent() {
  const store = useAgentStore
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Watchdog: start / kill driven by agentState ─────────────────────
  const agentState = store((s) => s.agentState)

  useEffect(() => {
    if (isAgentActive(agentState)) {
      // Agent is active — ensure watchdog is running
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      watchdogRef.current = setTimeout(() => {
        console.warn('[useAgent] Watchdog: agent stuck for 120s, forcing abort')
        window.api.agent.abort()
        store.getState().dispatchAgentEvent({ type: 'ABORT' })
        store.setState((s) => ({
          messages: [...s.messages, {
            id: `watchdog-${Date.now()}`,
            role: 'system',
            phase: 'complete',
            textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
            content: [{ type: 'text', text: '☕ 等了很久没有回应，我先休息一下，有事随时沟通' }],
            toolCalls: [],
            createdAt: Date.now(),
          }],
        }))
      }, WATCHDOG_TIMEOUT)
    } else {
      // Agent is idle/error/waitingForUserInput — kill watchdog
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
    }

    return () => {
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
    }
  }, [agentState, store])

  // ─── Watchdog: refresh on IPC events (only while active) ────────────
  const refreshWatchdog = useCallback(() => {
    if (!watchdogRef.current) return // not active, nothing to refresh
    clearTimeout(watchdogRef.current)
    watchdogRef.current = setTimeout(() => {
      console.warn('[useAgent] Watchdog: agent stuck for 120s, forcing abort')
      window.api.agent.abort()
      store.getState().dispatchAgentEvent({ type: 'ABORT' })
      store.setState((s) => ({
        messages: [...s.messages, {
          id: `watchdog-${Date.now()}`,
          role: 'system',
          phase: 'complete',
          textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
          content: [{ type: 'text', text: '☕ 等了很久没有回应，我先休息一下，有事随时沟通' }],
          toolCalls: [],
          createdAt: Date.now(),
        }],
      }))
    }, WATCHDOG_TIMEOUT)
  }, [store])

  // ─── IPC Subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    const unsubEvent = window.api.agent.onEvent((msg: AgentIPCMessage) => {
      store.getState().processIPCMessage(msg)
      refreshWatchdog()
    })

    const unsubPerm = window.api.agent.onPermissionRequest((req: PermissionRequestIPC) => {
      store.getState().handlePermissionRequest(req)
      refreshWatchdog()
    })

    const unsubAsk = window.api.agent.onAskUser((req: AskUserRequestIPC) => {
      store.getState().handleAskUserRequest(req)
      refreshWatchdog()
    })

    const unsubAskTimeout = window.api.agent.onAskUserTimeout((data: { requestId: string }) => {
      store.getState().handleAskUserTimeout(data.requestId)
    })

    const unsubSession = window.api.agent.onSessionCreated((sessionId: string) => {
      store.setState({ currentSessionId: sessionId })
      refreshWatchdog()
    })

    const unsubSkillOutput = window.api.agent.onSkillOutput((state) => {
      store.getState().handleSkillOutput(state)
      refreshWatchdog()
    })

    return () => {
      unsubEvent()
      unsubPerm()
      unsubAsk()
      unsubAskTimeout()
      unsubSession()
      unsubSkillOutput()
    }
  }, [store, refreshWatchdog])

  // ─── Actions ────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (prompt: string, activeFilePath?: string) => {
    const state = store.getState()
    if (state.agentState !== 'idle' && state.agentState !== 'error') {
      state.dispatchAgentEvent({ type: 'ABORT' })
      await window.api.agent.abort()
    }
    store.setState((s) => ({
      messages: [...s.messages, {
        id: `user-${Date.now()}`,
        role: 'user',
        phase: 'complete',
        textContent: prompt,
        content: [{ type: 'text', text: prompt }],
        toolCalls: [],
        createdAt: Date.now(),
      }],
      isStreaming: true,
      agentState: 'thinking',
    }))
    store.getState().dispatchAgentEvent({ type: 'SEND_MESSAGE' })
    const skillId = store.getState().activeSkillId
    window.api.agent.sendMessage(prompt, store.getState().currentSessionId || undefined, activeFilePath, skillId || undefined)
  }, [store])

  const respondPermission = useCallback((requestId: string, behavior: 'allow' | 'deny') => {
    store.getState().handlePermissionResponse(requestId, behavior)
    window.api.agent.respondPermission(requestId, behavior)
  }, [store])

  const respondAskUser = useCallback((requestId: string, answer: string) => {
    store.getState().handleAskUserResponse(requestId, answer)
    store.getState().dispatchAgentEvent({ type: 'ASK_USER_RESPONDED' })
    window.api.agent.respondAskUser(requestId, answer)
  }, [store])

  const newSession = useCallback(() => {
    store.setState({
      messages: [],
      isStreaming: false,
      isResumingSession: false,
      currentSessionId: null,
      usageInfo: null,
      agentState: 'idle',
      permissionRequest: null,
      askUserRequest: null,
      lastEditedFile: null,
      activeSkillId: null,
      skillOutput: null,
      _acc: null,
      _firstContentSeen: false,
    })
  }, [store])

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.api.agent.listSdkSessions()
      store.setState({ sessionList: sessions })
    } catch (err) {
      console.error('[useAgent] Failed to load sessions:', err)
    }
  }, [store])

  const resumeSession = useCallback(async (sessionId: string) => {
    store.setState({
      messages: [],
      isStreaming: false,
      isResumingSession: true,
      currentSessionId: sessionId,
      usageInfo: null,
      agentState: 'idle',
      permissionRequest: null,
      askUserRequest: null,
    })

    try {
      const messages = await window.api.agent.loadSessionMessages(sessionId)
      for (const msg of messages) {
        store.getState().processIPCMessage(msg, { isReplay: true })
      }
    } catch (err) {
      console.error('[useAgent] Failed to resume session:', err)
    } finally {
      store.setState({ isResumingSession: false })
    }
  }, [store])

  return {
    sendMessage,
    respondPermission,
    respondAskUser,
    newSession,
    loadSessions,
    resumeSession,
  }
}

// ─── Selectors ────────────────────────────────────────────────────────

export const useMessages = () => useAgentStore((s) => s.messages)
export const useIsStreaming = () => useAgentStore((s) => s.isStreaming)
export const useCurrentSessionId = () => useAgentStore((s) => s.currentSessionId)
export const useAgentStatus = () => useAgentStore((s) => s.agentState)
export const useUsageInfo = () => useAgentStore((s) => s.usageInfo)
export const usePermissionRequest = () => useAgentStore((s) => s.permissionRequest)
export const useAskUserRequest = () => useAgentStore((s) => s.askUserRequest)
export const useSessionList = () => useAgentStore((s) => s.sessionList)
export const useLastEditedFile = () => useAgentStore((s) => s.lastEditedFile)
export const useActiveSkillId = () => useAgentStore((s) => s.activeSkillId)
export const useIsResumingSession = () => useAgentStore((s) => s.isResumingSession)
export const useSkillOutput = () => useAgentStore((s) => s.skillOutput)
