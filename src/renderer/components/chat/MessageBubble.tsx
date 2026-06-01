import { useState, useCallback, useEffect, useRef, memo, useSyncExternalStore } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import remarkGfm from 'remark-gfm'
import { FileText, FileCode, ExternalLink, MessageSquareText, Download, CircleStop } from 'lucide-react'
import type { ConversationMessage, TextMessage, ArtifactData } from '../../../shared/types'
import type { BundledTheme } from 'shiki'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import SkillOutputCard from './SkillOutputCard'

const REMARK_PLUGINS = [remarkGfm]
const STREAMDOWN_PLUGINS = { code, math }

function useCodeTheme(): [BundledTheme, BundledTheme] {
  const theme = useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb)
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => obs.disconnect()
    },
    () => document.documentElement.getAttribute('data-theme') as string | null
  )
  return theme === 'light'
    ? ['github-light', 'github-dark']
    : ['github-dark', 'github-light']
}

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
  isLastMessage: boolean
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ArtifactBubble({ artifact, messageId, onOpenFile, workspacePath, context }: {
  artifact: ArtifactData
  messageId: string
  onOpenFile?: (path: string) => void
  workspacePath?: string
  context: 'editor' | 'ask'
}) {
  const Icon = artifact.fileType === 'html' ? FileCode : FileText

  const handleOpen = () => {
    if (artifact.filePath) {
      if (artifact.fileType === 'html') {
        window.api.workspace.openInBrowser(artifact.filePath)
      } else {
        onOpenFile?.(artifact.filePath)
      }
    }
  }

  const handlePreview = async () => {
    if (artifact.content && artifact.fileType === 'html') {
      await window.api.workspace.previewArtifact({ fileName: artifact.fileName, content: artifact.content })
    }
  }

  const handleDownload = async () => {
    if (!artifact.content) return
    const result = await window.api.workspace.saveArtifact({
      fileName: artifact.fileName,
      content: artifact.content,
      defaultPath: workspacePath
    })
    if (result.success && result.filePath) {
      const msgs = [...useAgentStore.getState().slots[context].messages]
      const idx = msgs.findIndex((m) => m.id === messageId)
      if (idx >= 0 && msgs[idx].kind === 'artifact') {
        msgs[idx] = {
          ...msgs[idx],
          artifact: { ...msgs[idx].artifact, filePath: result.filePath, content: undefined }
        }
        useAgentStore.setState((s) => ({
          slots: { ...s.slots, [context]: { ...s.slots[context], messages: msgs } }
        }))
      }
    }
  }

  const hasFile = !!artifact.filePath
  const hasContent = !!artifact.content && !hasFile

  return (
    <div className="message-bubble message-assistant">
      <div className="artifact-bubble" onClick={hasFile ? handleOpen : undefined}>
        <Icon size={20} />
        <div className="artifact-info">
          <span className="artifact-name">{artifact.fileName}</span>
          <span className="artifact-action">
            {hasContent ? 'HTML 生成物' : artifact.fileType === 'html' ? '在浏览器中预览' : '在编辑器中打开'}
          </span>
        </div>
        {hasContent && artifact.fileType === 'html' && (
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

function UserBubble({ text, onSelectText, context }: {
  text: string
  onSelectText?: (text: string, context?: string) => void
  context: string
}) {
  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { setSelectionBtn(null); return }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { setSelectionBtn(null); return }
    setSelectionBtn({ text, x: rect.left + rect.width / 2, y: rect.top - 4 })
  }, [])

  const handleClickAddToChat = useCallback(() => {
    if (selectionBtn && onSelectText) { onSelectText(selectionBtn.text, context) }
    window.getSelection()?.removeAllRanges()
    setSelectionBtn(null)
  }, [selectionBtn, onSelectText])

  useEffect(() => {
    if (!selectionBtn) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.selection-action-btn')) setSelectionBtn(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selectionBtn])

  return (
    <div className="message-bubble message-user">
      <div className="message-user-content" ref={contentRef} onMouseUp={handleMouseUp}>
        {text}
      </div>
      {selectionBtn && onSelectText && (
        <div className="selection-action-btn" style={{ left: selectionBtn.x, top: selectionBtn.y }} onClick={handleClickAddToChat}>
          <MessageSquareText size={12} />
          添加到对话
        </div>
      )}
    </div>
  )
}

function AssistantBubble({ message, isLastMessage, skillOutput, codeTheme, onSelectText, context }: {
  message: TextMessage
  isLastMessage: boolean
  skillOutput: { skillId: string | null; content: string; isStreaming: boolean; language: string } | null
  codeTheme: [BundledTheme, BundledTheme]
  onSelectText?: (text: string, context?: string) => void
  context: string
}) {
  const isStreaming = message.phase === 'streaming' || message.phase === 'tool_calling'
  const showSkillOutput = isStreaming && isLastMessage && skillOutput && skillOutput.content.length > 0

  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { setSelectionBtn(null); return }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { setSelectionBtn(null); return }
    setSelectionBtn({ text, x: rect.left + rect.width / 2, y: rect.top - 4 })
  }, [])

  const handleClickAddToChat = useCallback(() => {
    if (selectionBtn && onSelectText) { onSelectText(selectionBtn.text, context) }
    window.getSelection()?.removeAllRanges()
    setSelectionBtn(null)
  }, [selectionBtn, onSelectText])

  useEffect(() => {
    if (!selectionBtn) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.selection-action-btn')) setSelectionBtn(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selectionBtn])

  return (
    <div className="message-bubble message-assistant">
      <div className="message-assistant-content" ref={contentRef} onMouseUp={handleMouseUp}>
        {message.toolCalls.length > 0 && (
          <div className="message-tool-calls">
            {message.toolCalls.map((tc) => (
              <ToolCallDisplay key={tc.toolUseId} toolCall={tc} />
            ))}
          </div>
        )}
        {showSkillOutput && (
          <SkillOutputCard content={skillOutput.content} isStreaming={skillOutput.isStreaming} language={skillOutput.language} />
        )}
        {message.textContent && (
          <div className="message-assistant-text">
            <div className="message-markdown">
              <Streamdown
                animated={{ animation: 'slideUp', sep: 'word', stagger: 30, duration: 200 }}
                plugins={STREAMDOWN_PLUGINS}
                remarkPlugins={REMARK_PLUGINS}
                shikiTheme={codeTheme}
                mode={isStreaming ? 'streaming' : 'static'}
                isAnimating={isStreaming}
                parseIncompleteMarkdown={isStreaming}
                lineNumbers={false}
                controls={false}
              >
                {stripSkillOutputBlock(message.textContent)}
              </Streamdown>
            </div>
          </div>
        )}
      </div>
      {selectionBtn && onSelectText && (
        <div className="selection-action-btn" style={{ left: selectionBtn.x, top: selectionBtn.y }} onClick={handleClickAddToChat}>
          <MessageSquareText size={12} />
          添加到对话
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({ message, onOpenFile, onSelectText, workspacePath, context, isLastMessage }: MessageBubbleProps): React.ReactElement {
  const codeTheme = useCodeTheme()
  const skillOutput = useAgentStore((s) => s.slots[context].skillOutput)

  switch (message.kind) {
    case 'stopped':
      return (
        <div className="message-bubble message-assistant message-stopped">
          <div className="message-stopped-content">
            <CircleStop size={16} />
            <span>{message.textContent}</span>
          </div>
        </div>
      )

    case 'status':
      if (message.phase === 'streaming') {
        return (
          <div className="message-bubble message-assistant">
            <div className="message-status-indicator">
              {message.textContent}
              <span className="status-dot" />
              <span className="status-dot" />
              <span className="status-dot" />
            </div>
          </div>
        )
      }
      return (
        <div className="message-bubble message-assistant">
          <div className="message-assistant-content">{message.textContent}</div>
        </div>
      )

    case 'artifact':
      return <ArtifactBubble artifact={message.artifact} messageId={message.id} onOpenFile={onOpenFile} workspacePath={workspacePath} context={context} />

    case 'user':
      return <UserBubble text={message.textContent} onSelectText={onSelectText} context={context} />

    case 'text':
      return (
        <AssistantBubble message={message} isLastMessage={isLastMessage} skillOutput={skillOutput} codeTheme={codeTheme} onSelectText={onSelectText} context={context} />
      )
  }
})

export default MessageBubble
