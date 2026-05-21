import { useState, useCallback, useEffect, useRef, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, FileHtml, ArrowSquareOut, ChatCircleText } from '@phosphor-icons/react'
import type { ChatMessage } from '../../store/agent-store'
import ToolCallDisplay from './ToolCallDisplay'
import SkillCard from './SkillCard'

const REMARK_PLUGINS = [remarkGfm]

interface MessageBubbleProps {
  message: ChatMessage
  skillFollowingMessages?: ChatMessage[]
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
}

function MessageBubble({ message, skillFollowingMessages, onOpenFile, onSelectText }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionBtn(null)
      return
    }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setSelectionBtn(null)
      return
    }
    setSelectionBtn({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 4
    })
  }, [])

  const handleClickAddToChat = useCallback(() => {
    if (selectionBtn && onSelectText) {
      onSelectText(selectionBtn.text)
    }
    window.getSelection()?.removeAllRanges()
    setSelectionBtn(null)
  }, [selectionBtn, onSelectText])

  // Clear selection button on any click outside
  useEffect(() => {
    if (!selectionBtn) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.selection-action-btn')) {
        setSelectionBtn(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selectionBtn])

  if (message.isStatusIndicator) {
    return (
      <div className="message-bubble message-assistant">
        <div className="message-status-indicator">
          {message.content}
          <span className="status-dot" />
          <span className="status-dot" />
          <span className="status-dot" />
        </div>
      </div>
    )
  }

  if (message.artifact) {
    const art = message.artifact
    const Icon = art.fileType === 'html' ? FileHtml : FileText
    const handleOpen = () => {
      if (!onOpenFile) return
      if (art.fileType === 'html') {
        window.api.workspace.openInBrowser(art.filePath)
      } else {
        onOpenFile(art.filePath)
      }
    }
    return (
      <div className="message-bubble message-assistant">
        <div className="artifact-bubble" onClick={handleOpen}>
          <Icon size={20} weight="regular" />
          <div className="artifact-info">
            <span className="artifact-name">{art.fileName}</span>
            <span className="artifact-action">
              {art.fileType === 'html' ? '在浏览器中预览' : '在编辑器中打开'}
            </span>
          </div>
          <ArrowSquareOut size={14} weight="regular" />
        </div>
      </div>
    )
  }

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}${isSystem ? ' message-system' : ''}`}>
      {isUser ? (
        <div className="message-user-content" ref={contentRef} onMouseUp={handleMouseUp}>
          {message.skillInfo && (
            <SkillCard
              skillInfo={message.skillInfo}
              toolCalls={skillFollowingMessages?.flatMap((m) => m.toolCalls || []) || message.toolCalls}
              onOpenFile={onOpenFile}
            />
          )}
          {message.content}
        </div>
      ) : (
        <div className="message-assistant-content" ref={contentRef} onMouseUp={handleMouseUp}>
          {message.skillInfo && (
            <SkillCard skillInfo={message.skillInfo} toolCalls={message.toolCalls} onOpenFile={onOpenFile} />
          )}
          {!message.skillInfo && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message-tool-calls">
              {message.toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolUseId} toolCall={tc} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{message.content}</ReactMarkdown>
            </div>
          )}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <span className="message-streaming-dots">· · ·</span>
          )}
        </div>
      )}
      {selectionBtn && onSelectText && (
        <div
          className="selection-action-btn"
          style={{ left: selectionBtn.x, top: selectionBtn.y }}
          onClick={handleClickAddToChat}
        >
          <ChatCircleText size={12} weight="bold" />
          添加到对话
        </div>
      )}
    </div>
  )
}

export default memo(MessageBubble)