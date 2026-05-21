import { useState, useCallback, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, FileHtml, ArrowSquareOut, ChatCircleText, DownloadSimple } from '@phosphor-icons/react'
import type { ChatMessage } from '../../store/agent-store'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import SkillCard from './SkillCard'
import SkillOutputCard from './SkillOutputCard'

const REMARK_PLUGINS = [remarkGfm]

function stripSkillOutputBlock(content: string): string {
  let result = content.replace(/```skill-output\n[\s\S]*?```/g, '')
  result = result.replace(/```skill-output\n[\s\S]*$/g, '')
  return result.trim()
}

function extractSkillOutputContent(content: string): string | null {
  const match = content.match(/```skill-output\n([\s\S]*?)```/)
  if (match) return match[1]
  const partialMatch = content.match(/```skill-output\n([\s\S]*)$/)
  if (partialMatch) return partialMatch[1]
  return null
}

interface MessageBubbleProps {
  message: ChatMessage & { streamingContent?: string }
  skillFollowingMessages?: ChatMessage[]
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
  workspacePath?: string
}

function MessageBubble({ message, skillFollowingMessages, onOpenFile, onSelectText, workspacePath }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  // For streaming messages, use streamingContent; for completed messages, use message.content
  const displayContent = message.streamingContent ?? message.content
  const isStreaming = message.isStreaming ?? false
  const skillOutput = isStreaming ? extractSkillOutputContent(displayContent) : null

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
        useAgentStore.getState().updateArtifactFilePath(message.id, result.filePath)
      }
    }

    const hasFile = !!art.filePath
    const hasContent = !!art.content && !hasFile

    return (
      <div className="message-bubble message-assistant">
        <div className="artifact-bubble" onClick={hasFile ? handleOpen : undefined}>
          <Icon size={20} weight="regular" />
          <div className="artifact-info">
            <span className="artifact-name">{art.fileName}</span>
            <span className="artifact-action">
              {hasContent ? 'HTML 生成物' : art.fileType === 'html' ? '在浏览器中预览' : '在编辑器中打开'}
            </span>
          </div>
          {hasContent && art.fileType === 'html' && (
            <button className="artifact-action-btn" onClick={handlePreview} title="在浏览器中预览">
              <ArrowSquareOut size={14} weight="regular" />
            </button>
          )}
          {hasContent && (
            <button className="artifact-download-btn" onClick={handleDownload} title="下载到本地">
              <DownloadSimple size={14} weight="bold" />
            </button>
          )}
          {hasFile && <ArrowSquareOut size={14} weight="regular" />}
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
          {skillOutput && (
            <SkillOutputCard
              content={skillOutput}
              isStreaming={isStreaming}
              language="html"
            />
          )}
          {displayContent && (
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                {stripSkillOutputBlock(displayContent)}
              </ReactMarkdown>
            </div>
          )}
          {isStreaming && !displayContent && !message.toolCalls?.length && !skillOutput && (
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

export default MessageBubble