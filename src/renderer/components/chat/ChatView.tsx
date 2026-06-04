import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { MessageCircleMore, ChevronUp, Loader2 } from 'lucide-react'
import { useMessages, useIsStreaming, useIsResumingSession, useAgentStatus } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'
import styles from './ChatView.module.css'
import type { AgentContext } from '../../../shared/types'

const RENDER_BATCH = 100
const SCROLL_NEAR_BOTTOM = 80 // px threshold for "user is at bottom"
const SMOOTH_SCROLL_GROWTH = 10 // growth above this uses smooth scroll

interface ChatViewProps {
  context: AgentContext
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
  /** Optional external scroll container — when provided, ChatView delegates scrolling to it */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

function ChatView({ context, onOpenFile, onSelectText, workspacePath, scrollContainerRef: externalScrollRef }: ChatViewProps): React.ReactElement {
  const messages = useMessages(context)
  const isStreaming = useIsStreaming(context)
  const isResuming = useIsResumingSession()
  const agentState = useAgentStatus(context)
  const bottomRef = useRef<HTMLDivElement>(null)
  const internalContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = externalScrollRef || internalContainerRef
  const userScrolledUpRef = useRef(false)
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH)

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, messages.length - visibleCount)
    return { items: messages.slice(start), start }
  }, [messages, visibleCount])

  const hasMore = messages.length > visibleCount

  // Force-scroll to bottom (always, ignores user scroll position)
  const forceScrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [containerRef])

  // Detect manual scroll-up to pause auto-scroll during streaming
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUpRef.current = distFromBottom > SCROLL_NEAR_BOTTOM
  }, [containerRef])

  // When using external scroll container, bind scroll listener via useEffect
  useEffect(() => {
    if (!externalScrollRef) return
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [externalScrollRef, containerRef, handleScroll])

  // New message arrived (not during streaming) → always scroll to bottom
  const prevMsgCount = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMsgCount.current && !isStreaming) {
      forceScrollToBottom()
    }
    prevMsgCount.current = messages.length
  }, [messages.length, isStreaming, forceScrollToBottom])

  // ── Auto-scroll during streaming ──
  // useLayoutEffect runs synchronously during React commit, BEFORE paint.
  // With plain-text streaming (no Streamdown overhead), layout cost is minimal
  // and the scroll adjustment happens in the same frame as the content update.
  const prevScrollHeightRef = useRef(0)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !isStreaming || userScrolledUpRef.current) return
    const newHeight = el.scrollHeight
    const growth = newHeight - prevScrollHeightRef.current
    if (growth > 0 && prevScrollHeightRef.current > 0) {
      el.scrollBy({
        top: growth,
        behavior: growth > SMOOTH_SCROLL_GROWTH ? 'smooth' : 'instant',
      })
    }
    prevScrollHeightRef.current = newHeight
  }, [messages, isStreaming, containerRef])

  // Reset visibleCount only when messages are cleared (new session), not on threshold crossings
  useEffect(() => {
    if (messages.length === 0) {
      setVisibleCount(RENDER_BATCH)
    }
  }, [messages.length])

  return (
    <div className={styles.chatView} ref={externalScrollRef ? undefined : internalContainerRef} onScroll={externalScrollRef ? undefined : handleScroll} aria-live="polite" aria-label="对话消息">
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
                {agentState === 'thinking' ? '思考中' : '整理思路中'}
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