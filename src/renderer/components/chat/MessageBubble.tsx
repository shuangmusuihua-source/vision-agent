import { lazy, Suspense, useState, useCallback, useEffect, useRef, memo } from 'react'
import { FileText, FileCode, ExternalLink, MessageSquareText, Download, CircleStop, Image as ImageIcon, Check, ChevronDown, CircleAlert } from 'lucide-react'
import type { ConversationMessage, TextMessage, ArtifactData, UserMessage } from '../../../shared/types'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import { ComponentRenderer, extractJsonRenderBlocks } from './ComponentRender'
import {
  fileExtension,
  isConvertibleAttachmentPath,
  stripInternalAttachmentContext,
  type AttachmentKind,
} from '../../../shared/file-attachments'
import { getSkillInvocationDisplayText } from '../../../shared/skill-invocation'
import { stripSkillOutputBlock } from './message-text-utils'

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown'))

interface MessageBubbleProps {
  message: ConversationMessage
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
  context: 'editor' | 'ask'
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
  const markArtifactSaved = useAgentStore((s) => s.markArtifactSaved)

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
      markArtifactSaved(context, messageId, result.filePath)
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

const ATTACHMENT_LINE_REGEX = /^附件[：:]\s*(.+?)\s+\|\s+类型[：:]\s*(.+?)\s+\|\s+(?:路径|原始路径)[：:]\s*(.+)$/
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

interface ParsedAttachment {
  name: string
  path?: string
  label?: string
  type: AttachmentKind
  convertible: boolean
}

function attachmentTypeFor(name: string, path?: string, label?: string): AttachmentKind {
  const ext = fileExtension(path || name)
  if (label?.includes('图片') || IMAGE_ATTACHMENT_EXTENSIONS.has(ext)) return 'image'
  if (label?.toLowerCase().includes('pdf') || ext === 'pdf') return 'pdf'
  return 'text'
}

function parseAttachmentLine(line: string): ParsedAttachment | null {
  const structuredMatch = line.match(ATTACHMENT_LINE_REGEX)
  if (structuredMatch) {
    const name = structuredMatch[1].trim()
    const label = structuredMatch[2].trim()
    const path = structuredMatch[3].trim()

    const type = attachmentTypeFor(name, path, label)
    return {
      name,
      path,
      label,
      type,
      convertible: isConvertibleAttachmentPath(path || name),
    }
  }

  return null
}

function parseAttachments(text: string): { attachments: ParsedAttachment[]; body: string } {
  const lines = text.split('\n')
  const attachments: ParsedAttachment[] = []
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const attachment = parseAttachmentLine(lines[i])
    if (attachment) {
      attachments.push(attachment)
      bodyStart = i + 1
    } else {
      break
    }
  }
  return { attachments, body: lines.slice(bodyStart).join('\n').trimStart() }
}

function attachmentMeta(attachment: ParsedAttachment): string {
  if (attachment.type === 'image') return attachment.label || '图片'
  if (attachment.label) return attachment.label.replace(/文档$/, '')
  const ext = fileExtension(attachment.path || attachment.name)
  return ext ? ext.toUpperCase() : '文件'
}

function attachmentDisplayName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name
}

type AttachmentReadMode = 'processing' | 'done' | 'failed'

function attachmentStatusTitle(attachments: ParsedAttachment[], mode: AttachmentReadMode): string {
  const action = mode === 'processing' ? '正在理解' : mode === 'failed' ? '读取失败' : '已读取'
  if (attachments.length === 1) return `${action}《${attachmentDisplayName(attachments[0].name)}》`
  return mode === 'failed' ? `${attachments.length} 个附件读取失败` : `${action} ${attachments.length} 个附件`
}

function attachmentStatusSubtitle(mode: AttachmentReadMode): string {
  if (mode === 'processing') return '正在提取文本，完成后会继续回答'
  if (mode === 'failed') return '提取文本失败，请重新上传或检查文件'
  return '提取文本成功'
}

function UserBubble({ text, messageId, attachmentConversions, onSelectText, context }: {
  text: string
  messageId: string
  attachmentConversions?: UserMessage['attachmentConversions']
  onSelectText?: (text: string, context?: string) => void
  context: 'editor' | 'ask'
}) {
  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const visibleText = getSkillInvocationDisplayText(text) || stripInternalAttachmentContext(text)
  const { attachments, body } = parseAttachments(visibleText)
  const isLatestStreamingUserMessage = useAgentStore((s) => {
    const slot = s.slots[context]
    const latestUser = [...slot.messages].reverse().find((msg) => msg.kind === 'user')
    return slot.isStreaming && latestUser?.id === messageId
  })

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

  const readableAttachments = attachments.filter((attachment) => attachment.convertible)
  const failedAttachmentPaths = new Set((attachmentConversions || [])
    .filter((item) => item.status === 'failed')
    .map((item) => item.sourcePath))
  const failedAttachments = readableAttachments.filter((attachment) => (
    attachment.path ? failedAttachmentPaths.has(attachment.path) : false
  ))
  const hasConversionResults = Boolean(attachmentConversions?.length)
  const isReadingAttachments = isLatestStreamingUserMessage && readableAttachments.length > 0 && !hasConversionResults
  const attachmentReadMode: AttachmentReadMode = isReadingAttachments
    ? 'processing'
    : failedAttachments.length > 0
      ? 'failed'
      : 'done'

  return (
    <div className={`message-bubble message-user${attachments.length > 0 ? ' message-user-with-attachments' : ''}`}>
      {attachments.length > 0 && (
        <div className="message-attach-stack">
          <div className="message-attach-cards">
            {attachments.map((attachment, i) => {
              const conversion = attachmentConversions?.find((item) => item.sourcePath === attachment.path)
              const isUnderstanding = isLatestStreamingUserMessage && attachment.convertible && !conversion
              const isFailed = conversion?.status === 'failed'
              const statusLabel = isUnderstanding
                ? '正在理解'
                : isFailed
                  ? '读取失败'
                  : conversion?.status === 'converted'
                    ? '已读取'
                    : '已上传'
              const Icon = attachment.type === 'image' ? ImageIcon : FileText
              return (
                <div
                  key={i}
                  className={`message-attach-card${isUnderstanding ? ' message-attach-card--understanding' : ''}${isFailed ? ' message-attach-card--failed' : ''}`}
                  title={conversion?.error || attachment.path}
                >
                  <span className={`message-attach-card-icon message-attach-card-icon--${attachment.type}`}>
                    <Icon size={18} />
                  </span>
                  <span className="message-attach-card-copy">
                    <span className="message-attach-card-name">{attachment.name}</span>
                    <span className="message-attach-card-meta">
                      {attachmentMeta(attachment)}
                      {' · '}
                      {statusLabel}
                    </span>
                  </span>
                  {isUnderstanding ? (
                    <span className="message-attach-card-progress" aria-label="正在理解附件" />
                  ) : isFailed ? (
                    <span className="message-attach-card-error" aria-label="附件读取失败">
                      <CircleAlert size={16} />
                    </span>
                  ) : (
                    <span className="message-attach-card-check" aria-label={conversion?.status === 'converted' ? '附件已读取' : '附件已上传'}>
                      <Check size={16} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {readableAttachments.length > 0 && (
            <div
              className={`message-attach-status message-attach-status--${attachmentReadMode}`}
              title={attachmentConversions?.find((item) => item.status === 'failed')?.error}
            >
              <span className="message-attach-status-icon" aria-hidden="true">
                {isReadingAttachments ? (
                  <span className="message-attach-status-dot"></span>
                ) : attachmentReadMode === 'failed' ? (
                  <CircleAlert size={14} />
                ) : (
                  <Check size={14} />
                )}
              </span>
              <span className="message-attach-status-copy">
                <span className="message-attach-status-title">
                  {attachmentStatusTitle(
                    attachmentReadMode === 'failed' ? failedAttachments : readableAttachments,
                    attachmentReadMode
                  )}
                </span>
                <span className="message-attach-status-subtitle">
                  {attachmentStatusSubtitle(attachmentReadMode)}
                </span>
              </span>
              <ChevronDown size={16} className="message-attach-status-chevron" />
            </div>
          )}
        </div>
      )}
      {(body || attachments.length === 0) && (
        <div className="message-user-content" ref={contentRef} onMouseUp={handleMouseUp}>
          {attachments.length > 0 ? <div className="message-user-text">{body}</div> : visibleText}
        </div>
      )}
      {selectionBtn && onSelectText && (
        <div className="selection-action-btn" style={{ left: selectionBtn.x, top: selectionBtn.y }} onClick={handleClickAddToChat}>
          <MessageSquareText size={12} />
          添加到对话
        </div>
      )}
    </div>
  )
}

function AssistantBubble({ message, onSelectText, context }: {
  message: TextMessage
  onSelectText?: (text: string, context?: string) => void
  context: string
}) {
  const isStreaming = message.phase === 'streaming' || message.phase === 'tool_calling'

  // Extract json-render blocks from the message text
  const { blocks: jsonRenderBlocks, cleanText } = !isStreaming
    ? extractJsonRenderBlocks(message.textContent)
    : { blocks: [], cleanText: message.textContent }

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
        {jsonRenderBlocks.length > 0 && (
          <div className="message-json-render-blocks">
            {jsonRenderBlocks.map((block, i) => (
              <ComponentRenderer key={i} spec={block} />
            ))}
          </div>
        )}
        {cleanText && (
          <div className="message-assistant-text">
            <div className="message-markdown">
              <Suspense fallback={<span>{stripSkillOutputBlock(cleanText)}</span>}>
                <AssistantMarkdown text={cleanText} isStreaming={isStreaming} />
              </Suspense>
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

const MessageBubble = memo(function MessageBubble({ message, onOpenFile, onSelectText, workspacePath, context }: MessageBubbleProps): React.ReactElement {
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
      return (
        <UserBubble
          text={message.textContent}
          messageId={message.id}
          attachmentConversions={message.attachmentConversions}
          onSelectText={onSelectText}
          context={context}
        />
      )

    case 'text':
      return (
        <AssistantBubble message={message} onSelectText={onSelectText} context={context} />
      )
  }
}, (prev, next) => {
  // Skip re-render if nothing visible changed (reduces jank during streaming)
  const a = prev.message, b = next.message
  if (a.id !== b.id) return false
  if (a.kind !== b.kind) return false
  // For text messages during streaming, compare the fields that affect rendering
  if (a.kind === 'text' && b.kind === 'text') {
    return a.textContent === b.textContent
      && a.phase === b.phase
      && a.toolCalls === b.toolCalls
      && a.skillMeta === b.skillMeta
  }
  // For other types, use shallow reference comparison of key fields
  return a === b
})

export default MessageBubble
