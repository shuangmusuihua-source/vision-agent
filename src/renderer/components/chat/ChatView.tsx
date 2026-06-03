import { useEffect, useRef, useMemo, useState } from 'react'
import { MessageCircleMore, ChevronUp, Loader2 } from 'lucide-react'
import { useMessages, useIsStreaming, useIsResumingSession, useAgentStatus } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'
import styles from './ChatView.module.css'
import type { AgentContext } from '../../../shared/types'

const RENDER_BATCH = 100

interface ChatViewProps {
  context: AgentContext
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
}

function ChatView({ context, onOpenFile, onSelectText, workspacePath }: ChatViewProps): React.ReactElement {
  const messages = useMessages(context)
  const isStreaming = useIsStreaming(context)
  const isResuming = useIsResumingSession()
  const agentState = useAgentStatus(context)
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

  // Scroll when thinking indicator appears
  useEffect(() => {
    if (isStreaming && agentState === 'thinking') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isStreaming && agentState === 'thinking'])

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isStreaming])

  useEffect(() => {
    setVisibleCount(RENDER_BATCH)
  }, [messages.length > RENDER_BATCH ? 'long' : 'short'])

  return (
    <div className={styles.chatView} aria-live="polite" aria-label="对话消息">
      {isResuming && (
        <div className={styles.chatLoading}>
          <Loader2 size={24} className="spin" /> 加载会话历史…
        </div>
      )}
      {messages.length === 0 && !isResuming && (
        <div className={styles.chatEmpty}>
          <MessageCircleMore size={48} className={styles.chatEmptyIcon} />
          <span className={styles.chatEmptyHint}>开始对话</span>
        </div>
      )}
      {hasMore && (
        <button className={styles.chatLoadMore} onClick={() => setVisibleCount((c) => c + RENDER_BATCH)}>
          <ChevronUp size={14} /> 加载更早消息 ({messages.length - visibleCount} 条)
        </button>
      )}
      {visibleMessages.items.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          context={context}
          onOpenFile={onOpenFile}
          onSelectText={onSelectText}
          workspacePath={workspacePath}
          isLastMessage={idx === visibleMessages.items.length - 1}
        />
      ))}
      {isStreaming && (() => {
        // Keep indicator visible until actual text content arrives,
        // bridging the gap between thinking→running and the first visible tokens.
        const lastMsg = messages[messages.length - 1]
        const hasContent = lastMsg && lastMsg.kind === 'text' && lastMsg.textContent.length > 0
        if (agentState === 'thinking' || (agentState === 'running' && !hasContent)) {
          return (
            <div className="message-bubble message-assistant message-thinking-indicator">
              <div className="message-status-indicator">
                {agentState === 'thinking' ? '思考中' : '生成中'}
                <span className="status-dot" />
                <span className="status-dot" />
                <span className="status-dot" />
              </div>
            </div>
          )
        }
        return null
      })()}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView
