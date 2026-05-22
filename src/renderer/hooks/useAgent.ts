import { useEffect, useCallback } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import type { ToolCall, ChatMessage, SkillInfo } from '../store/agent-store'
import type { AskUserRequest } from '../lib/ipc'

// SDK message type discriminator
type SDKMsg = Record<string, unknown>

function getMessageType(msg: SDKMsg): string {
  return (msg.type as string) || ''
}

function getSubtype(msg: SDKMsg): string {
  return (msg.subtype as string) || ''
}

const STATUS_TEXT: Record<string, string> = {
  thinking: '正在思考',
  requesting: '正在思考',
  compacting: '正在压缩上下文'
}

// Track whether we've received stream_events for the current turn
let hasStreamEvents = false

// Module-level ref for tool call association — survives across renders
const lastAssistantMsgIdRef = { current: null as string | null }

// Process incoming SDK messages — reads state via getState(), no stale closures
function handleAgentMessage(msg: SDKMsg) {
  const state = useAgentStore.getState()
  const { messages, currentSessionId, activeSkillInfo } = state
  const {
    addMessage, updateLastAssistantMessage,
    replaceLastAssistantMessage, finishStreaming, setToolCall,
    updateToolCallResult, setStreaming, setSessionId, setAgentStatus,
    setUsageInfo, setPermissionRequest, setLastEditedFile
  } = state

  const type = getMessageType(msg)
  const subtype = getSubtype(msg)

  // --- system: init ---
  if (type === 'system' && subtype === 'init') {
    const sessionId = msg.session_id as string
    if (sessionId && !currentSessionId) {
      setSessionId(sessionId)
    }
    return
  }

  // --- assistant message ---
  if (type === 'assistant') {
    const apiMessage = msg.message as SDKMsg | undefined
    const content = apiMessage?.content as Array<SDKMsg> | undefined
    if (!content) return

    const textParts = content
      .filter((c) => c.type === 'text')
      .map((c) => (c.text as string) || '')

    const toolUses = content.filter((c) => c.type === 'tool_use')

    // Skip text content if stream_events already delivered it token-by-token
    if (textParts.length > 0 && !hasStreamEvents) {
      const textContent = textParts.join('')
      const lastMsg = messages[messages.length - 1]

      if (lastMsg?.isStatusIndicator) {
        replaceLastAssistantMessage(textContent)
      } else if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
        updateLastAssistantMessage(textContent)
      } else {
        const msgId = `assistant-${Date.now()}`
        addMessage({
          id: msgId,
          role: 'assistant',
          content: textContent,
          isStreaming: true,
          skillInfo: activeSkillInfo || undefined
        })
        lastAssistantMsgIdRef.current = msgId
      }
    }

    if (toolUses.length > 0) {
      let targetMsgId = lastAssistantMsgIdRef.current
      if (!targetMsgId) {
        const lastMsg = messages[messages.length - 1]
        if (lastMsg?.role === 'assistant') {
          targetMsgId = lastMsg.id
        } else {
          const msgId = `assistant-${Date.now()}`
          addMessage({
            id: msgId,
            role: 'assistant',
            content: '',
            isStreaming: true,
            skillInfo: activeSkillInfo || undefined
          })
          targetMsgId = msgId
          lastAssistantMsgIdRef.current = msgId
        }
      }

      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.isStatusIndicator) {
        replaceLastAssistantMessage('')
      }

      for (const tu of toolUses) {
        const toolName = (tu.name as string) || 'unknown'
        if (toolName === 'AskUserQuestion') continue
        const toolUseId = (tu.id as string) || `tu-${Date.now()}`
        // Skip if this tool call already exists in the message
        const existingMsg = messages.find((m) => m.id === targetMsgId)
        if (existingMsg?.toolCalls?.some((tc) => tc.toolUseId === toolUseId)) continue
        const toolCall: ToolCall = {
          toolName,
          toolUseId,
          input: (tu.input as Record<string, unknown>) || {},
          status: 'running'
        }
        setToolCall(targetMsgId, toolCall)

        if (toolName === 'Write' || toolName === 'Edit') {
          const editedPath = (toolCall.input as Record<string, unknown>).file_path as string
          if (editedPath) {
            setLastEditedFile(editedPath)
          }
        }
      }

      setAgentStatus('running')
    }

    if (textParts.length === 0 && toolUses.length === 0) {
      setAgentStatus('thinking')
    }

    return
  }

  // --- user message (contains tool_result from SDK) ---
  if (type === 'user') {
    const apiMessage = msg.message as SDKMsg | undefined
    const content = apiMessage?.content as Array<SDKMsg> | undefined
    if (!content) return

    const toolResults = content.filter((c) => c.type === 'tool_result')
    if (toolResults.length > 0) {
      const targetMsgId = lastAssistantMsgIdRef.current
      if (targetMsgId) {
        for (const tr of toolResults) {
          const toolUseId = (tr.tool_use_id as string) || ''
          const resultContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map((c: SDKMsg) => c.text || '').join('')
              : JSON.stringify(tr.content)
          const isError = tr.is_error === true
          updateToolCallResult(targetMsgId, toolUseId, resultContent, isError ? 'error' : 'completed')
        }
      }
    }
    return
  }

  // --- result: success ---
  if (type === 'result' && subtype === 'success') {
    const costUsd = (msg.total_cost_usd as number) || 0
    const durationMs = (msg.duration_ms as number) || 0
    const usage = msg.usage as SDKMsg | undefined

    setUsageInfo({
      inputTokens: (usage?.input_tokens as number) || 0,
      outputTokens: (usage?.output_tokens as number) || 0,
      costUsd,
      durationMs
    })

    finishStreaming()
    return
  }

  // --- result: error ---
  if (type === 'result' && (subtype === 'error_max_turns' || subtype === 'error_during_execution' || subtype === 'error_max_budget_usd')) {
    const errors = (msg.errors as string[]) || []
    const costUsd = (msg.total_cost_usd as number) || 0
    const durationMs = (msg.duration_ms as number) || 0

    setUsageInfo({
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
      durationMs
    })

    addMessage({
      id: `error-${Date.now()}`,
      role: 'assistant',
      content: errors.join('\n') || `Agent error: ${subtype}`,
      isStreaming: false
    })
    finishStreaming()
    setAgentStatus('error')
    return
  }

  // --- system: permission_denied ---
  if (type === 'system' && subtype === 'permission_denied') {
    const toolUseId = msg.tool_use_id as string
    const targetMsgId = lastAssistantMsgIdRef.current

    if (targetMsgId && toolUseId) {
      updateToolCallResult(targetMsgId, toolUseId, `Permission denied: ${msg.message}`, 'error')
    }
    return
  }

  // --- status message ---
  if (type === 'status') {
    const statusType = msg.status as string
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.isStatusIndicator && STATUS_TEXT[statusType]) {
      updateLastAssistantMessage(STATUS_TEXT[statusType])
    }
    if (statusType === 'compacting') {
      setAgentStatus('compacting')
    } else if (statusType === 'requesting') {
      setAgentStatus('thinking')
    }
    return
  }

  // --- notification ---
  if (type === 'system' && subtype === 'notification') {
    return
  }

  // --- stream_event ---
  if (type === 'stream_event') {
    return
  }

  // --- compact_boundary ---
  if (type === 'system' && subtype === 'compact_boundary') {
    setAgentStatus('compacting')
    return
  }

  // --- task_notification ---
  if (type === 'system' && subtype === 'task_notification') {
    return
  }

  // --- tool_use_summary ---
  if (type === 'system' && subtype === 'tool_use_summary') {
    return
  }
}

// Handle stream_event messages — token-by-token text deltas
// Updates streamingContent (independent store field) instead of messages array
function handleStreamEvent(streamMsg: SDKMsg) {
  const event = streamMsg.event as SDKMsg | undefined
  if (!event) return

  const eventType = event.type as string

  // text_delta — incremental text content
  if (eventType === 'content_block_delta') {
    hasStreamEvents = true
    const delta = event.delta as SDKMsg | undefined
    if (delta?.type === 'text_delta') {
      const text = (delta.text as string) || ''
      if (text) {
        const { appendStreamingContent, messages, addMessage, activeSkillInfo, setAgentStatus } = useAgentStore.getState()
        const lastMsg = messages[messages.length - 1]

        // Ensure an assistant message exists for tool calls to attach to
        // Skip status indicators — they'll be removed in finishStreaming
        if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.isStreaming || lastMsg.isStatusIndicator) {
          const msgId = `assistant-${Date.now()}`
          addMessage({ id: msgId, role: 'assistant', content: '', isStreaming: true, isStatusIndicator: false, skillInfo: activeSkillInfo || undefined })
          lastAssistantMsgIdRef.current = msgId
        }

        appendStreamingContent(text)
        setAgentStatus('running')
      }
    }
  }
}

function useAgent() {
  const messages = useAgentStore((s) => s.messages)
  const streamingContent = useAgentStore((s) => s.streamingContent)
  const isStreaming = useAgentStore((s) => s.isStreaming)
  const currentSessionId = useAgentStore((s) => s.currentSessionId)
  const agentStatus = useAgentStore((s) => s.agentStatus)
  const usageInfo = useAgentStore((s) => s.usageInfo)
  const permissionRequest = useAgentStore((s) => s.permissionRequest)
  const askUserRequest = useAgentStore((s) => s.askUserRequest)
  const sessionList = useAgentStore((s) => s.sessionList)
  const lastEditedFile = useAgentStore((s) => s.lastEditedFile)
  const lastEditedFileTime = useAgentStore((s) => s.lastEditedFileTime)
  const activeSkillInfo = useAgentStore((s) => s.activeSkillInfo)

  const addMessage = useAgentStore((s) => s.addMessage)
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const setAgentStatus = useAgentStore((s) => s.setAgentStatus)
  const setPermissionRequest = useAgentStore((s) => s.setPermissionRequest)
  const setAskUserRequest = useAgentStore((s) => s.setAskUserRequest)
  const setSessionId = useAgentStore((s) => s.setSessionId)
  const setSessionList = useAgentStore((s) => s.setSessionList)
  const setLastEditedFile = useAgentStore((s) => s.setLastEditedFile)
  const setActiveSkillInfo = useAgentStore((s) => s.setActiveSkillInfo)
  const clearMessages = useAgentStore((s) => s.clearMessages)
  const finishStreaming = useAgentStore((s) => s.finishStreaming)
  const respondPermission = useAgentStore((s) => s.respondPermission)

  // Register IPC listeners once
  useEffect(() => {
    const unsubMessage = window.api.agent.onMessage((data) => {
      const msg = data as { sessionId: string; message: SDKMsg }
      handleAgentMessage(msg.message)
    })

    const unsubStreamEvent = window.api.agent.onStreamEvent((data) => {
      handleStreamEvent(data as SDKMsg)
    })

    const unsubSession = window.api.agent.onSessionCreated((sessionId) => {
      useAgentStore.getState().setSessionId(sessionId)
    })

    const unsubComplete = window.api.agent.onComplete(() => {
      useAgentStore.getState().finishStreaming()
    })

    const unsubError = window.api.agent.onError((data) => {
      const err = data as { error: string }
      const { addMessage, setStreaming, setAgentStatus } = useAgentStore.getState()
      addMessage({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.error}`,
        isStreaming: false
      })
      setStreaming(false)
      setAgentStatus('error')
    })

    const unsubPermission = window.api.agent.onPermissionRequest((data) => {
      const req = data as { id: string; toolName: string; input: Record<string, unknown> }
      useAgentStore.getState().setPermissionRequest({
        id: req.id,
        toolName: req.toolName,
        input: req.input
      })
    })

    const unsubAskUser = window.api.agent.onAskUser((data: unknown) => {
      const req = data as AskUserRequest
      const { setAskUserRequest, setAgentStatus } = useAgentStore.getState()
      setAskUserRequest(req)
      setAgentStatus('waitingForUserInput')
    })

    const unsubAskUserTimeout = window.api.agent.onAskUserTimeout((data: unknown) => {
      const { requestId } = data as { requestId: string }
      const { addMessage, setAskUserRequest, setAgentStatus } = useAgentStore.getState()
      addMessage({
        id: `timeout-${Date.now()}`,
        role: 'system',
        content: '⏱ 等待回答超时，Agent 已停止等待',
        isStreaming: false
      })
      setAskUserRequest(null)
      setAgentStatus('idle')
    })

    return () => {
      unsubMessage()
      unsubStreamEvent()
      unsubSession()
      unsubComplete()
      unsubError()
      unsubPermission()
      unsubAskUser()
      unsubAskUserTimeout()
    }
  }, [])

  const sendMessage = useCallback(
    async (prompt: string, activeFilePath?: string) => {
      const { addMessage, setStreaming, setAgentStatus, currentSessionId } = useAgentStore.getState()
      // Reset stream tracking for new turn
      hasStreamEvents = false
      addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt
      })
      const statusId = `status-${Date.now()}`
      addMessage({
        id: statusId,
        role: 'assistant',
        content: STATUS_TEXT.thinking,
        isStreaming: true,
        isStatusIndicator: true
      })
      lastAssistantMsgIdRef.current = statusId
      setStreaming(true)
      setAgentStatus('thinking')
      await window.api.agent.sendMessage(prompt, currentSessionId || undefined, activeFilePath)
    },
    []
  )

  const respondPerm = useCallback(
    async (requestId: string, behavior: 'allow' | 'deny') => {
      try {
        await window.api.agent.respondPermission(requestId, behavior)
        useAgentStore.getState().setPermissionRequest(null)
      } catch {
        // IPC failed — keep dialog visible so user can retry
      }
    },
    []
  )

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.api.agent.listSdkSessions()
      useAgentStore.getState().setSessionList(sessions as Array<{ id: string; title?: string; createdAt?: string; mtime?: string }>)
    } catch (err) {
      console.error('[useAgent] loadSessions error:', err)
      useAgentStore.getState().setSessionList([])
    }
  }, [])

  const resumeSession = useCallback(async (sessionId: string) => {
    const { clearMessages, setSessionId } = useAgentStore.getState()
    clearMessages()
    setSessionId(sessionId)
    try {
      const msgs = await window.api.agent.loadSessionMessages(sessionId)
      for (const msg of msgs) {
        handleAgentMessage(msg as SDKMsg)
      }
    } catch (err) {
      console.error('[useAgent] resumeSession error:', err)
    }
  }, [])

  const newSession = useCallback(() => {
    const { clearMessages, setSessionId } = useAgentStore.getState()
    clearMessages()
    setSessionId(null)
  }, [])

  const respondAskUser = useCallback(async (requestId: string, answer: string) => {
    const { addMessage, setAskUserRequest, setAgentStatus } = useAgentStore.getState()
    addMessage({
      id: `user-answer-${Date.now()}`,
      role: 'user',
      content: answer,
      isStreaming: false
    })
    await window.api.agent.respondAskUser(requestId, answer)
    setAskUserRequest(null)
    setAgentStatus('running')
  }, [])

  return {
    messages,
    streamingContent,
    isStreaming,
    currentSessionId,
    agentStatus,
    usageInfo,
    permissionRequest,
    askUserRequest,
    sessionList,
    lastEditedFile,
    lastEditedFileTime,
    activeSkillInfo,
    sendMessage,
    addMessage,
    respondPermission: respondPerm,
    respondAskUser,
    loadSessions,
    resumeSession,
    newSession,
    setActiveSkillInfo,
    clearMessages
  }
}

export { useAgentStore }

export function useMessages() {
  return useAgentStore((s) => s.messages)
}

export function useIsStreaming() {
  return useAgentStore((s) => s.isStreaming)
}

export function useAgentStatus() {
  return useAgentStore((s) => s.agentStatus)
}

export function usePermissionRequest() {
  return useAgentStore((s) => s.permissionRequest)
}

export function useAskUserRequest() {
  return useAgentStore((s) => s.askUserRequest)
}

export function useActiveSkillInfo() {
  return useAgentStore((s) => s.activeSkillInfo)
}

export function useSessionList() {
  return useAgentStore((s) => s.sessionList)
}

export function useCurrentSessionId() {
  return useAgentStore((s) => s.currentSessionId)
}

export function useUsageInfo() {
  return useAgentStore((s) => s.usageInfo)
}

export function useStreamingContent() {
  return useAgentStore((s) => s.streamingContent)
}

export default useAgent