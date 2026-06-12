import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { MessageCircleMore, ChevronUp, Loader2 } from 'lucide-react'
import { useAgent, useMessages, useIsStreaming, useIsResumingSession, useAgentStatus, useTtftMs, useCurrentSessionId } from '../../hooks/useAgent'
import { useAgentStore } from '../../store/agent-store-impl'
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
  const ttftMs = useTtftMs(context)
  const bottomRef = useRef<HTMLDivElement>(null)
  const internalContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = externalScrollRef || internalContainerRef
  const userScrolledUpRef = useRef(false)
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH)

  // ── SDK load-more wiring (self-contained, per context) ────────────────
  const { loadMoreMessages, hasMoreSdkMessages, isLoadingMoreMessages } = useAgent(context)
  const currentSessionId = useCurrentSessionId(context)

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, messages.length - visibleCount)
    return { items: messages.slice(start), start }
  }, [messages, visibleCount])

  const hasMore = messages.length > visibleCount

  const handleLoadMore = useCallback(async () => {
    if (hasMoreSdkMessages) {
      const sid = currentSessionId
      // Capture scrollHeight before prepend so we can adjust scrollTop
      // to keep the user's reading position stable after older messages
      // are inserted above the viewport.
      const el = containerRef.current
      const prevScrollHeight = el ? el.scrollHeight : 0
      if (sid) await loadMoreMessages(sid)
      // SDK load prepends messages to the front — the visible window
      // starts from the end, so expand to show everything loaded so far.
      // Read fresh state from Zustand directly (bypasses React render cycle
      // timing — more reliable than a ref synced via useEffect).
      setVisibleCount(useAgentStore.getState().slots[context].messages.length)
      // After React renders the prepended content, adjust scrollTop to
      // compensate for the scrollHeight growth — keeps reading position stable.
      if (el && prevScrollHeight > 0) {
        requestAnimationFrame(() => {
          const growth = el.scrollHeight - prevScrollHeight
          if (growth > 0) el.scrollTop += growth
        })
      }
    } else {
      setVisibleCount((c) => c + RENDER_BATCH)
    }
  }, [hasMoreSdkMessages, currentSessionId, loadMoreMessages, context, containerRef])

  // Force-scroll to bottom (always, ignores user scroll position)
  const forceScrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [containerRef])

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

  // Reset visibleCount and scroll height ref when messages are cleared (new session)
  useEffect(() => {
    if (messages.length === 0) {
      setVisibleCount(RENDER_BATCH)
      prevScrollHeightRef.current = 0
      prevMsgCount.current = 0
    }
  }, [messages.length])

  // Scroll handler: detect manual scroll-up to pause auto-scroll during streaming
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
      {isLoadingMoreMessages && (
        <button className={styles.chatLoadMore} disabled>
          <Loader2 size={14} className="spin" /> 加载SDK消息...
        </button>
      )}
      {!isLoadingMoreMessages && (hasMore || hasMoreSdkMessages) && (
        <button className={styles.chatLoadMore} onClick={handleLoadMore}>
          <ChevronUp size={14} />{' '}
          {hasMoreSdkMessages
            ? `加载更早消息`
            : `加载更早消息 (${messages.length - visibleCount} 条)`}
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
        // "思考中" — thinking phase, before any content arrives
        // "整理思路中" — running/compacting, but no visible text in the last reply yet.
        // Once text appears in the bubble, the indicator is no longer needed.
        const lastMsg = messages[messages.length - 1]
        const hasVisibleText = lastMsg?.kind === 'text' && (lastMsg.textContent?.length ?? 0) > 0
        if (agentState === 'thinking' || ((agentState === 'running' || agentState === 'compacting') && !hasVisibleText)) {
          // Show ttft_ms when available (after first message_start from SDK)
          const latencyHint = ttftMs != null ? ` · 首字节 ${ttftMs < 1000 ? `${Math.round(ttftMs)}ms` : `${(ttftMs / 1000).toFixed(1)}s`}` : ''
          return (
            <div className="message-bubble message-assistant message-thinking-indicator">
              <div className="message-status-indicator">
                {agentState === 'thinking' ? '思考中' : '整理思路中'}{latencyHint}
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