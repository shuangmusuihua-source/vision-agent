import { useEffect, useCallback, useRef } from 'react'
import { useAgentStore } from '../store/agent-store-impl'
import type { ToolCall } from '../store/agent-store'

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
    addMessage,
    updateLastAssistantMessage,
    appendToLastAssistantMessage,
    finishStreaming,
    setToolCall,
    updateToolCallResult,
    setStreaming,
    setSessionId,
    setAgentStatus,
    setUsageInfo,
    setPermissionRequest,
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

    return () => {
      unsubMessage()
      unsubSession()
      unsubComplete()
      unsubError()
      unsubPermission()
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

          if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
            // Update existing streaming message
            updateLastAssistantMessage(textContent)
          } else {
            // New assistant message
            const msgId = `assistant-${Date.now()}`
            addMessage({
              id: msgId,
              role: 'assistant',
              content: textContent,
              isStreaming: true
            })
            lastAssistantMsgIdRef.current = msgId
          }
        }

        // Handle tool_use blocks
        if (toolUses.length > 0) {
          // Ensure we have an assistant message to attach tool calls to
          let targetMsgId = lastAssistantMsgIdRef.current
          if (!targetMsgId) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg?.role === 'assistant') {
              targetMsgId = lastMsg.id
            } else {
              // Create a placeholder assistant message for tool calls
              const msgId = `assistant-${Date.now()}`
              addMessage({
                id: msgId,
                role: 'assistant',
                content: '',
                isStreaming: true
              })
              targetMsgId = msgId
              lastAssistantMsgIdRef.current = msgId
            }
          }

          for (const tu of toolUses) {
            const toolCall: ToolCall = {
              toolName: (tu.name as string) || 'unknown',
              toolUseId: (tu.id as string) || `tu-${Date.now()}`,
              input: (tu.input as Record<string, unknown>) || {},
              status: 'running'
            }
            setToolCall(targetMsgId, toolCall)
          }

          setAgentStatus('running')
        }

        // If no text and no tool_use, just mark as thinking
        if (textParts.length === 0 && toolUses.length === 0) {
          setAgentStatus('thinking')
        }

        return
      }

      // --- result: success ---
      if (type === 'result' && subtype === 'success') {
        const resultText = (msg.result as string) || ''
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

        // If there's a result text and no assistant message captured it,
        // add as final assistant message
        if (resultText) {
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
            updateLastAssistantMessage(resultText)
          } else if (!lastMsg || lastMsg.role !== 'assistant') {
            addMessage({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: resultText,
              isStreaming: false
            })
          }
        }

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
    [messages, addMessage, updateLastAssistantMessage, appendToLastAssistantMessage, finishStreaming, setToolCall, updateToolCallResult, setStreaming, setSessionId, setAgentStatus, setUsageInfo]
  )

  const sendMessage = useCallback(
    async (prompt: string) => {
      addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt
      })
      setStreaming(true)
      setAgentStatus('thinking')
      lastAssistantMsgIdRef.current = null
      await window.api.agent.sendMessage(prompt, currentSessionId || undefined)
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

  return {
    messages,
    isStreaming,
    agentStatus,
    usageInfo,
    permissionRequest,
    sendMessage,
    respondPermission,
    clearMessages
  }
}

export default useAgent