import { useEffect, useRef, useMemo } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
import type { ChatMessage } from '../../store/agent-store'
import { useMessages, useIsStreaming, useStreamingContent } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
  workspacePath?: string
}

function ChatView({ onOpenFile, onSelectText, workspacePath }: ChatViewProps): React.ReactElement {
  const messages = useMessages()
  const isStreaming = useIsStreaming()
  const streamingContent = useStreamingContent()
  const bottomRef = useRef<HTMLDivElement>(null)

  const prevMsgCount = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMsgCount.current = messages.length
  }, [messages.length])

  const skillToolCallsMap = useMemo(() => {
    const map = new Map<string, ChatMessage[]>()
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].skillInfo && messages[i].role === 'user') {
        const following: ChatMessage[] = []
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'assistant' && messages[j].skillInfo) {
            following.push(messages[j])
          } else if (messages[j].role === 'user') {
            break
          }
        }
        map.set(messages[i].id, following)
      }
    }
    return map
  }, [messages])

  // Find the last streaming assistant message to inject streamingContent
  const lastStreamingIdx = useMemo(() => {
    if (!isStreaming) return -1
    return messages.findLastIndex((m) => m.role === 'assistant' && m.isStreaming)
  }, [messages, isStreaming])

  return (
    <div className="chat-view">
      {messages.length === 0 && (
        <div className="chat-empty">
          <ChatCircleDots size={48} weight="thin" className="chat-empty-icon" />
          <span className="chat-empty-hint">开始对话</span>
        </div>
      )}
      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          message={idx === lastStreamingIdx ? { ...msg, streamingContent } : msg}
          skillFollowingMessages={skillToolCallsMap.get(msg.id)}
          onOpenFile={onOpenFile}
          onSelectText={onSelectText}
          workspacePath={workspacePath}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView