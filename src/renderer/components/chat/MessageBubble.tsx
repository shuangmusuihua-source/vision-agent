import { useState, useCallback, useEffect, useRef, memo } from 'react'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { FileText, FileCode, ExternalLink, MessageSquareText, Download, CircleStop } from 'lucide-react'
import type { ConversationMessage } from '../../../shared/types'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import SkillOutputCard from './SkillOutputCard'

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

function stripSkillOutputBlock(content: string): string {
  let result = content.replace(/```skill-output\n[\s\S]*?```/g, '')
  result = result.replace(/```skill-output\n[\s\S]*$/g, '')
  return result.trim()
}

interface MessageBubbleProps {
  message: ConversationMessage
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
  context: 'editor' | 'ask'
}

const MessageBubble = memo(function MessageBubble({ message, onOpenFile, onSelectText, workspacePath, context }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const displayContent = message.textContent
  const isStreaming = message.phase === 'streaming' || message.phase === 'tool_calling'

  // Unified skill output from main process bridge (via store)
  const skillOutput = useAgentStore((s) => s.slots[context].skillOutput)

  // Only show SkillOutputCard for the last assistant message during streaming
  const isLastMessage = useAgentStore((s) => s.slots[context].messages[s.slots[context].messages.length - 1]?.id === message.id)
  const showSkillOutput = isStreaming && isLastMessage && skillOutput && skillOutput.content.length > 0

  // Status indicator: system messages with 'thinking' text during streaming
  const isStatusIndicator = message.role === 'system' && message.phase === 'streaming'

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
      onSelectText(selectionBtn.text, context)
    }
    window.getSelection()?.removeAllRanges()
    setSelectionBtn(null)
  }, [selectionBtn, onSelectText])

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

  if (message.phase === 'stopped') {
    return (
      <div className="message-bubble message-assistant message-stopped">
        <div className="message-stopped-content">
          <CircleStop size={16} />
          <span>{displayContent}</span>
        </div>
      </div>
    )
  }

  if (isStatusIndicator) {
    return (
      <div className="message-bubble message-assistant">
        <div className="message-status-indicator">
          {displayContent}
          <span className="status-dot" />
          <span className="status-dot" />
          <span className="status-dot" />
        </div>
      </div>
    )
  }

  if (message.artifact) {
    const art = message.artifact
    const Icon = art.fileType === 'html' ? FileCode : FileText

    const handleOpen = () => {
      if (art.filePath) {
        if (art.fileType === 'html') {
          window.api.workspace.openInBrowser(art.filePath)
        } else {
          onOpenFile?.(art.filePath)
        }
      }
    }

    const handlePreview = async () => {
      if (art.content && art.fileType === 'html') {
        await window.api.workspace.previewArtifact({ fileName: art.fileName, content: art.content })
      }
    }

    const handleDownload = async () => {
      if (!art.content) return
      const result = await window.api.workspace.saveArtifact({
        fileName: art.fileName,
        content: art.content,
        defaultPath: workspacePath
      })
      if (result.success && result.filePath) {
        // Update artifact path in the message
        const msgs = [...useAgentStore.getState().slots[context].messages]
        const idx = msgs.findIndex((m) => m.id === message.id)
        if (idx >= 0 && msgs[idx].artifact) {
          msgs[idx] = {
            ...msgs[idx],
            artifact: { ...msgs[idx].artifact!, filePath: result.filePath, content: undefined }
          }
          useAgentStore.setState((s) => ({
            slots: {
              ...s.slots,
              [context]: { ...s.slots[context], messages: msgs }
            }
          }))
        }
      }
    }

    const hasFile = !!art.filePath
    const hasContent = !!art.content && !hasFile

    return (
      <div className="message-bubble message-assistant">
        <div className="artifact-bubble" onClick={hasFile ? handleOpen : undefined}>
          <Icon size={20} />
          <div className="artifact-info">
            <span className="artifact-name">{art.fileName}</span>
            <span className="artifact-action">
              {hasContent ? 'HTML 生成物' : art.fileType === 'html' ? '在浏览器中预览' : '在编辑器中打开'}
            </span>
          </div>
          {hasContent && art.fileType === 'html' && (
            <button className="artifact-action-btn" onClick={handlePreview} title="在浏览器中预览">
              <ExternalLink size={14} />
            </button>
          )}
          {hasContent && (
            <button className="artifact-download-btn" onClick={handleDownload} title="下载到本地">
              <Download size={14} />
            </button>
          )}
          {hasFile && <ExternalLink size={14} />}
        </div>
      </div>
    )
  }

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}${isSystem ? ' message-system' : ''}`}>
      {isUser ? (
        <div className="message-user-content" ref={contentRef} onMouseUp={handleMouseUp}>
          {message.textContent}
        </div>
      ) : (
        <div className="message-assistant-content" ref={contentRef} onMouseUp={handleMouseUp}>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message-tool-calls">
              {message.toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolUseId} toolCall={tc} />
              ))}
            </div>
          )}
          {showSkillOutput && (
            <SkillOutputCard
              content={skillOutput.content}
              isStreaming={skillOutput.isStreaming}
              language={skillOutput.language}
            />
          )}
          {displayContent && (
            <div className="message-assistant-text">
              <div className="message-markdown">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
                  {stripSkillOutputBlock(displayContent)}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
      {selectionBtn && onSelectText && (
        <div
          className="selection-action-btn"
          style={{ left: selectionBtn.x, top: selectionBtn.y }}
          onClick={handleClickAddToChat}
        >
          <MessageSquareText size={12} />
          添加到对话
        </div>
      )}
    </div>
  )
})

export default MessageBubble