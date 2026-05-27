import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Monitor, FolderOpen, FileText, PresentationChart, MagnifyingGlass, ChartBar, ArrowUp, ChatCircleDots, CaretUp, Spinner } from '@phosphor-icons/react'
import { useMessages, useIsStreaming, useIsResumingSession, useAgentStatus } from '../../hooks/useAgent'
import { useAgentStore } from '../../store/agent-store-impl'
import MessageBubble from '../chat/MessageBubble'

const RENDER_BATCH = 100

interface FeatureCard {
  icon: React.ComponentType<{ size: number; weight: string; className?: string }>
  title: string
  desc: string
  colorClass: string
  prompt: string
}

const FEATURES: FeatureCard[] = [
  { icon: Monitor, title: '管理电脑', desc: '整理桌面、清理文件、管理应用', colorClass: 'ask-card-purple', prompt: '帮我管理电脑' },
  { icon: FolderOpen, title: '整理文件', desc: '分类归档、批量重命名、去重', colorClass: 'ask-card-pink', prompt: '帮我整理文件' },
  { icon: FileText, title: '写文档', desc: '简历、报告、方案、会议纪要', colorClass: 'ask-card-blue', prompt: '帮我写文档' },
  { icon: PresentationChart, title: '做 PPT', desc: '演示文稿、产品展示、培训课件', colorClass: 'ask-card-green', prompt: '帮我做PPT' },
  { icon: MagnifyingGlass, title: '搜索知识', desc: '知识库检索、信息整理、摘要', colorClass: 'ask-card-orange', prompt: '帮我搜索知识' },
  { icon: ChartBar, title: '分析数据', desc: '数据解读、趋势分析、可视化', colorClass: 'ask-card-teal', prompt: '帮我分析数据' },
]

interface AskZuovisProps {
  onSend: (message: string) => void
  disabled?: boolean
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
  workspacePath?: string
}

function AskZuovis({ onSend, disabled, onOpenFile, onSelectText, workspacePath }: AskZuovisProps): React.ReactElement {
  const [inputText, setInputText] = useState('')
  const messages = useMessages('ask')
  const isStreaming = useIsStreaming('ask')
  const isResuming = useIsResumingSession()
  const agentState = useAgentStatus('ask')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH)

  const hasMessages = messages.length > 0

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, messages.length - visibleCount)
    return { items: messages.slice(start), start }
  }, [messages, visibleCount])

  const hasMore = messages.length > visibleCount

  // Auto-scroll
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isStreaming])

  useEffect(() => {
    if (isStreaming && agentState === 'thinking') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isStreaming, agentState])

  useEffect(() => {
    setVisibleCount(RENDER_BATCH)
  }, [messages.length > RENDER_BATCH ? 'long' : 'short'])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (text && !disabled) {
      onSend(text)
      setInputText('')
    }
  }, [inputText, onSend, disabled])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleCardClick = useCallback((prompt: string) => {
    if (!disabled) onSend(prompt)
  }, [onSend, disabled])

  return (
    <div className="ask-zuovis">
      <div className="ask-zuovis-scroll" ref={scrollRef}>
        {isResuming && (
          <div className="ask-zuovis-resuming">
            <Spinner size={20} className="spin" /> 加载会话历史…
          </div>
        )}

        {!hasMessages ? (
          <div className="ask-zuovis-content">
            <div className="ask-zuovis-greeting">
              <div className="ask-zuovis-greeting-title">你好，有什么可以帮你？</div>
              <div className="ask-zuovis-greeting-sub">我是 Zuovis，你的智能助手</div>
            </div>

            <div className="ask-zuovis-grid">
              {FEATURES.map((feature) => {
                const Icon = feature.icon
                return (
                  <button
                    key={feature.title}
                    className={`ask-zuovis-card ${feature.colorClass}`}
                    onClick={() => handleCardClick(feature.prompt)}
                  >
                    <div className="ask-zuovis-card-icon">
                      <Icon size={16} weight="regular" />
                    </div>
                    <div className="ask-zuovis-card-title">{feature.title}</div>
                    <div className="ask-zuovis-card-desc">{feature.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="ask-zuovis-messages-inner">
            {hasMore && (
              <button className="chat-load-more" onClick={() => setVisibleCount((c) => c + RENDER_BATCH)}>
                <CaretUp size={14} weight="bold" /> 加载更早消息 ({messages.length - visibleCount} 条)
              </button>
            )}
            {visibleMessages.items.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                context="ask"
                onOpenFile={onOpenFile}
                onSelectText={onSelectText}
                workspacePath={workspacePath}
              />
            ))}
            {isStreaming && agentState === 'thinking' && (
              <div className="message-bubble message-assistant message-thinking-indicator">
                <div className="message-status-indicator">
                  思考中
                  <span className="status-dot" />
                  <span className="status-dot" />
                  <span className="status-dot" />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="ask-zuovis-footer">
        <div className="ask-zuovis-capsule">
          <input
            type="text"
            className="ask-zuovis-input"
            placeholder="问 Zuovis 任何问题..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoFocus
          />
          <button
            className={`ask-zuovis-send-btn ${inputText.trim() && !disabled ? 'ask-zuovis-send-btn-active' : ''}`}
            onClick={handleSend}
            disabled={!inputText.trim() || disabled}
            type="button"
          >
            <ArrowUp size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AskZuovis