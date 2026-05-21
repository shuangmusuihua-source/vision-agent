import { useEffect, useRef, useMemo } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
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