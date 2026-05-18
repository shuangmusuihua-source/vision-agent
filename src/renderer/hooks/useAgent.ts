import { useEffect, useCallback, useRef } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import type { ToolCall } from '../store/agent-store'
import type { AskUserRequest } from '../lib/ipc'

// SDK message type discriminator
type SDKMsg = Record<string, unknown>

function getMessageType(msg: SDKMsg): string {
  return (msg.type as string) || ''
}

function getSubtype(msg: SDKMsg): string {
  return (msg.subtype as string) || ''
}

function useAgent() {
  const {
    messages,
    isStreaming,
    currentSessionId,
    agentStatus,
    usageInfo,
    permissionRequest,
    sessionList,
    lastEditedFile,
    lastEditedFileTime,
    activeSkillInfo,
    addMessage,
    updateLastAssistantMessage,
    appendToLastAssistantMessage,
    replaceLastAssistantMessage,
    finishStreaming,
    setToolCall,
    updateToolCallResult,
    setStreaming,
    setSessionId,
    setAgentStatus,
    setUsageInfo,
    setPermissionRequest,
    setAskUserRequest,
    askUserRequest,
    setSessionList,
    setLastEditedFile,
    setActiveSkillInfo,
    clearMessages
  } = useAgentStore()

  // Track the last assistant message ID for tool call association
  const lastAssistantMsgIdRef = useRef<string | null>(null)

  useEffect(() => {
    const unsubMessage = window.api.agent.onMessage((data) => {
      const msg = data as { sessionId: string; message: SDKMsg }
      handleAgentMessage(msg.message)
    })

    const unsubSession = window.api.agent.onSessionCreated((sessionId) => {
      setSessionId(sessionId)
    })

    const unsubComplete = window.api.agent.onComplete(() => {
      finishStreaming()
    })

    const unsubError = window.api.agent.onError((data) => {
      const err = data as { error: string }
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
      setPermissionRequest({
        id: req.id,
        toolName: req.toolName,
        input: req.input
      })
    })

    const unsubAskUser = window.api.agent.onAskUser((data: unknown) => {
      const req = data as AskUserRequest
      setAskUserRequest(req)
      setAgentStatus('waitingForUserInput')
      addMessage({
        id: req.id,
        role: 'assistant',
        content: req.question,
        isStreaming: false
      })
    })

    const unsubAskUserTimeout = window.api.agent.onAskUserTimeout((data: unknown) => {
      const { requestId } = data as { requestId: string }
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
      unsubSession()
      unsubComplete()
      unsubError()
      unsubPermission()
      unsubAskUser()
      unsubAskUserTimeout()
    }
  }, [])

  const handleAgentMessage = useCallback(
    (msg: SDKMsg) => {
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

        // Extract text blocks
        const textParts = content
          .filter((c) => c.type === 'text')
          .map((c) => (c.text as string) || '')

        // Extract tool_use blocks
        const toolUses = content.filter((c) => c.type === 'tool_use')

        // Handle text content
        if (textParts.length > 0) {
          const textContent = textParts.join('')
          const lastMsg = messages[messages.length - 1]

          if (lastMsg?.isStatusIndicator) {
            replaceLastAssistantMessage(textContent)
          } else if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
            appendToLastAssistantMessage(textContent)
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

        // Handle tool_use blocks
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

          // Clear status indicator when tool calls arrive
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.isStatusIndicator) {
            replaceLastAssistantMessage('')
          }

          for (const tu of toolUses) {
            const toolName = (tu.name as string) || 'unknown'
            const toolCall: ToolCall = {
              toolName,
              toolUseId: (tu.id as string) || `tu-${Date.now()}`,
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
        const sessionId = msg.session_id as string
        const costUsd = (msg.total_cost_usd as number) || 0
        const durationMs = (msg.duration_ms as number) || 0
        const usage = msg.usage as SDKMsg | undefined

        setUsageInfo({
          inputTokens: (usage?.input_tokens as number) || 0,
          outputTokens: (usage?.output_tokens as number) || 0,
          costUsd,
          durationMs
        })

        // Mark last streaming message as complete — don't add result text
        // (assistant messages already captured the content)
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
        const toolName = msg.tool_name as string
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
        // Forward to UI as a lightweight assistant message if it has content
        const notificationMsg = (msg.message as string) || ''
        if (notificationMsg) {
          // Don't add as chat message — these are status updates
        }
        return
      }

      // --- stream_event (partial message) ---
      if (type === 'stream_event') {
        // Partial streaming events — we handle the full assistant message instead
        return
      }

      // --- compact_boundary ---
      if (type === 'system' && subtype === 'compact_boundary') {
        setAgentStatus('compacting')
        return
      }

      // --- task_notification (background subagent completed) ---
      if (type === 'system' && subtype === 'task_notification') {
        // Background task completed — could show notification
        return
      }

      // --- tool_use_summary ---
      if (type === 'system' && subtype === 'tool_use_summary') {
        // Summary of tool uses — informational
        return
      }

      // Ignore other message types (hook events, plugin installs, etc.)
    },
    [messages, addMessage, updateLastAssistantMessage, appendToLastAssistantMessage, replaceLastAssistantMessage, finishStreaming, setToolCall, updateToolCallResult, setStreaming, setSessionId, setAgentStatus, setUsageInfo, activeSkillInfo]
  )

  const STATUS_TEXT: Record<string, string> = {
    thinking: '正在思考...',
    requesting: '正在思考...',
    compacting: '正在压缩上下文...'
  }

  const sendMessage = useCallback(
    async (prompt: string, activeFilePath?: string) => {
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
    [currentSessionId, addMessage, setStreaming, setAgentStatus]
  )

  const respondPermission = useCallback(
    async (requestId: string, behavior: 'allow' | 'deny') => {
      setPermissionRequest(null)
      await window.api.agent.respondPermission(requestId, behavior)
    },
    [setPermissionRequest]
  )

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.api.agent.listSdkSessions()
      setSessionList(sessions as Array<{ id: string; title?: string; createdAt?: string; mtime?: string }>)
    } catch (err) {
      console.error('[useAgent] loadSessions error:', err)
      setSessionList([])
    }
  }, [setSessionList])

  const resumeSession = useCallback(async (sessionId: string) => {
    try {
      clearMessages()
      setSessionId(sessionId)
      const msgs = await window.api.agent.loadSessionMessages(sessionId)
      for (const msg of msgs) {
        handleAgentMessage(msg as SDKMsg)
      }
    } catch (err) {
      console.error('[useAgent] resumeSession error:', err)
    }
  }, [clearMessages, setSessionId, handleAgentMessage])

  const newSession = useCallback(() => {
    clearMessages()
    setSessionId(null)
  }, [clearMessages, setSessionId])

  const respondAskUser = useCallback(async (requestId: string, answer: string) => {
      addMessage({
        id: `user-answer-${Date.now()}`,
        role: 'user',
        content: answer,
        isStreaming: false
      })
      await window.api.agent.respondAskUser(requestId, answer)
      setAskUserRequest(null)
      setAgentStatus('running')
    }, [addMessage, setAskUserRequest, setAgentStatus])

    return {
    messages,
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
    respondPermission,
    respondAskUser,
    loadSessions,
    resumeSession,
    newSession,
    setActiveSkillInfo,
    clearMessages
  }
}

export default useAgent