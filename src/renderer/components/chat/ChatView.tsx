import { useEffect, useRef, useMemo, useState } from 'react'
import { ChatCircleDots, CaretUp, Spinner } from '@phosphor-icons/react'
import { useMessages, useIsStreaming, useIsResumingSession } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'
import type { ConversationMessage } from '../../../shared/types'

const RENDER_BATCH = 100

interface ChatViewProps {
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
  workspacePath?: string
}

function ChatView({ onOpenFile, onSelectText, workspacePath }: ChatViewProps): React.ReactElement {
  const messages = useMessages()
  const isStreaming = useIsStreaming()
  const isResuming = useIsResumingSession()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH)

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, messages.length - visibleCount)
    return { items: messages.slice(start), start }
  }, [messages, visibleCount])

  const hasMore = messages.length > visibleCount

  const prevMsgCount = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMsgCount.current = messages.length
  }, [messages.length])

  useEffect(() => {
    setVisibleCount(RENDER_BATCH)
  }, [messages.length > RENDER_BATCH ? 'long' : 'short'])

  return (
    <div className="chat-view" aria-live="polite" aria-label="对话消息">
      {isResuming && (
        <div className="chat-loading">
          <Spinner size={24} className="spin" /> 加载会话历史…
        </div>
      )}
      {messages.length === 0 && !isResuming && (
        <div className="chat-empty">
          <ChatCircleDots size={48} weight="thin" className="chat-empty-icon" />
          <span className="chat-empty-hint">开始对话</span>
        </div>
      )}
      {hasMore && (
        <button className="chat-load-more" onClick={() => setVisibleCount((c) => c + RENDER_BATCH)}>
          <CaretUp size={14} weight="bold" /> 加载更早消息 ({messages.length - visibleCount} 条)
        </button>
      )}
      {visibleMessages.items.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
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
