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
} from '../../shared/types'

/**
 * useAgent — thin IPC subscription layer.
 *
 * All message processing logic lives in the store (processIPCMessage).
 * This hook's only job:
 *   1. Subscribe to IPC events on mount
 *   2. Forward typed messages to store.processIPCMessage
 *   3. Expose concise action functions for UI components
 */
export function useAgent() {
  const store = useAgentStore

  // ─── IPC Subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    // Unified agent:event channel
    const unsubEvent = window.api.agent.onEvent((msg: AgentIPCMessage) => {
      store.getState().processIPCMessage(msg)
    })

    // Permission request (separate channel for request/response pattern)
    const unsubPerm = window.api.agent.onPermissionRequest((req: PermissionRequestIPC) => {
      store.getState().handlePermissionRequest(req)
    })

    // AskUser request
    const unsubAsk = window.api.agent.onAskUser((req: AskUserRequestIPC) => {
      store.getState().handleAskUserRequest(req)
    })

    // AskUser timeout
    const unsubAskTimeout = window.api.agent.onAskUserTimeout((data: { requestId: string }) => {
      store.getState().handleAskUserTimeout(data.requestId)
    })

    // Session created
    const unsubSession = window.api.agent.onSessionCreated((sessionId: string) => {
      store.setState({ currentSessionId: sessionId })
    })

    return () => {
      unsubEvent()
      unsubPerm()
      unsubAsk()
      unsubAskTimeout()
      unsubSession()
    }
  }, [store])

  // ─── Actions ────────────────────────────────────────────────────────

  const sendMessage = useCallback((prompt: string, activeFilePath?: string) => {
    const state = store.getState()
    if (state.agentState !== 'idle' && state.agentState !== 'error') {
      state.dispatchAgentEvent({ type: 'ABORT' })
    }
    // Add user message bubble immediately
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
    state.dispatchAgentEvent({ type: 'SEND_MESSAGE' })
    window.api.agent.sendMessage(prompt, state.currentSessionId || undefined, activeFilePath)
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
      currentSessionId: null,
      usageInfo: null,
      agentState: 'idle',
      permissionRequest: null,
      askUserRequest: null,
      lastEditedFile: null,
      activeSkillId: null,
      _acc: null,
      _firstContentSeen: false,
    })
  }, [store])

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.api.agent.listSdkSessions()
      console.log('[useAgent] loadSessions returned', sessions.length, 'sessions')
      store.setState({ sessionList: sessions })
    } catch (err) {
      console.error('[useAgent] Failed to load sessions:', err)
    }
  }, [store])

  const resumeSession = useCallback(async (sessionId: string) => {
    store.setState({
      messages: [],
      isStreaming: false,
      currentSessionId: sessionId,
      usageInfo: null,
      agentState: 'idle',
      permissionRequest: null,
      askUserRequest: null,
    })

    try {
      const messages = await window.api.agent.loadSessionMessages(sessionId)
      // Replay historical messages as complete (no streaming)
      for (const msg of messages) {
        store.getState().processIPCMessage(msg, { isReplay: true })
      }
    } catch (err) {
      console.error('[useAgent] Failed to resume session:', err)
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
