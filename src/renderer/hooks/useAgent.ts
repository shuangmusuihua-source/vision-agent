import { useEffect, useCallback } from 'react'
import useAgentStore from '../store/agent-store-impl'

function useAgent() {
  const {
    messages,
    isStreaming,
    currentSessionId,
    addMessage,
    updateLastAssistantMessage,
    finishStreaming,
    setToolCall,
    setStreaming,
    setSessionId,
    clearMessages
  } = useAgentStore()

  useEffect(() => {
    const unsubMessage = window.api.agent.onMessage((data) => {
      const msg = data as { sessionId: string; message: Record<string, unknown> }
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
    })

    return () => {
      unsubMessage()
      unsubSession()
      unsubComplete()
      unsubError()
    }
  }, [])

  const handleAgentMessage = useCallback(
    (message: Record<string, unknown>) => {
      const type = message.type as string

      if (type === 'assistant') {
        // SDK: { type: 'assistant', message: { content: [{type:'text',text:'...'}] } }
        const apiMessage = message.message as Record<string, unknown> | undefined
        const content = apiMessage?.content as Array<Record<string, unknown>> | undefined
        const textContent = content
          ?.filter((c) => c.type === 'text')
          .map((c) => (c.text as string) || '')
          .join('')

        if (textContent) {
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
            updateLastAssistantMessage(textContent)
          } else {
            addMessage({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: textContent,
              isStreaming: true
            })
          }
        }

        // Tool use blocks within assistant message content
        const toolUses = content?.filter((c) => c.type === 'tool_use')
        if (toolUses && toolUses.length > 0) {
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'assistant') {
            for (const tu of toolUses) {
              setToolCall(lastMsg.id, {
                toolName: (tu.name as string) || 'unknown',
                input: (tu.input as Record<string, unknown>) || {},
                status: 'running'
              })
            }
          }
        }
      } else if (type === 'result') {
        // Final result — finish streaming
        finishStreaming()
      }
      // type === 'system' handled by onSessionCreated
    },
    [messages, addMessage, updateLastAssistantMessage, finishStreaming, setToolCall]
  )

  const sendMessage = useCallback(
    async (prompt: string) => {
      addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt
      })
      setStreaming(true)
      await window.api.agent.sendMessage(prompt, currentSessionId || undefined)
    },
    [currentSessionId, addMessage, setStreaming]
  )

  return {
    messages,
    isStreaming,
    sendMessage,
    clearMessages
  }
}

export default useAgent
