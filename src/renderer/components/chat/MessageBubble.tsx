import { useState, useCallback, useEffect, useRef, memo, useSyncExternalStore } from 'react'
import { Streamdown } from 'streamdown'
import type { DiagramPlugin } from 'streamdown'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import mermaid from 'mermaid'
import remarkGfm from 'remark-gfm'
import { FileText, FileCode, ExternalLink, MessageSquareText, Download, CircleStop, Image as ImageIcon } from 'lucide-react'
import type { ConversationMessage, TextMessage, ArtifactData } from '../../../shared/types'
import type { BundledTheme } from 'shiki'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import { ComponentRenderer, extractJsonRenderBlocks } from './ComponentRender'
import {
  fileExtension,
  isConvertibleAttachmentPath,
  stripInternalAttachmentContext,
  type AttachmentKind,
} from '../../../shared/file-attachments'

const REMARK_PLUGINS = [remarkGfm]

const mermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid(config) {
    if (config) mermaid.initialize(config)
    return {
      initialize(cfg) { mermaid.initialize({ ...cfg, startOnLoad: false }) },
      async render(id, source) {
        const { svg } = await mermaid.render(id, source)
        return { svg }
      },
    }
  },
}

const STREAMDOWN_PLUGINS = { code, math, mermaid: mermaidPlugin }

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

const LEGACY_ATTACH_REGEX = /^(📄|🖼️|📕)\s+(.+?)[：:]\s*(.+)$/
const ATTACHMENT_LINE_REGEX = /^附件[：:]\s*(.+?)\s+\|\s+类型[：:]\s*(.+?)\s+\|\s+(?:路径|原始路径)[：:]\s*(.+)$/
const ATTACH_PATH_SUFFIX_REGEX = /\s+\|\s+(?:路径|原始路径)[：:]\s*(.+)$/
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

interface ParsedAttachment {
  name: string
  path?: string
  label?: string
  type: AttachmentKind
  convertible: boolean
}

function parseLegacyAttachmentDisplay(value: string): { name: string; path?: string } {
  const pathMatch = value.match(ATTACH_PATH_SUFFIX_REGEX)
  if (!pathMatch || pathMatch.index === undefined) return { name: value }
  return {
    name: value.slice(0, pathMatch.index).trim(),
    path: pathMatch[1],
  }
}

function attachmentTypeFor(name: string, path?: string, label?: string, legacyIcon?: string): AttachmentKind {
  const ext = fileExtension(path || name)
  if (legacyIcon === '🖼️' || label?.includes('图片') || IMAGE_ATTACHMENT_EXTENSIONS.has(ext)) return 'image'
  if (legacyIcon === '📕' || label?.toLowerCase().includes('pdf') || ext === 'pdf') return 'pdf'
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

  const legacyMatch = line.match(LEGACY_ATTACH_REGEX)
  if (!legacyMatch) return null

  const display = parseLegacyAttachmentDisplay(legacyMatch[3])
  const type = attachmentTypeFor(display.name, display.path, legacyMatch[2], legacyMatch[1])
  return {
    name: display.name,
    path: display.path,
    label: legacyMatch[2],
    type,
    convertible: isConvertibleAttachmentPath(display.path || display.name),
  }
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

function UserBubble({ text, messageId, onSelectText, context }: {
  text: string
  messageId: string
  onSelectText?: (text: string, context?: string) => void
  context: 'editor' | 'ask'
}) {
  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const visibleText = stripInternalAttachmentContext(text)
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

  return (
    <div className="message-bubble message-user">
      <div className="message-user-content" ref={contentRef} onMouseUp={handleMouseUp}>
        {attachments.length > 0 ? (
          <>
            <div className={`message-attach-chips${body ? ' message-attach-chips--with-body' : ''}`}>
              {attachments.map((attachment, i) => {
                const isUnderstanding = isLatestStreamingUserMessage && attachment.convertible
                const Icon = attachment.type === 'image' ? ImageIcon : FileText
                return (
                  <span
                    key={i}
                    className={`message-attach-chip${isUnderstanding ? ' message-attach-chip--understanding' : ''}`}
                    title={attachment.path}
                  >
                    <span className="message-attach-chip-main">
                      <span className="message-attach-chip-icon"><Icon size={14} /></span>
                      <span className="message-attach-chip-name">{attachment.name}</span>
                    </span>
                    {isUnderstanding && (
                      <span className="message-attach-chip-status">
                        理解文档中
                        <span className="message-attach-chip-dots" aria-hidden="true">
                          <span>.</span><span>.</span><span>.</span>
                        </span>
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
            {body && <div className="message-user-text">{body}</div>}
          </>
        ) : (
          visibleText
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

function AssistantBubble({ message, codeTheme, onSelectText, context }: {
  message: TextMessage
  codeTheme: [BundledTheme, BundledTheme]
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
              <Streamdown
                plugins={STREAMDOWN_PLUGINS}
                remarkPlugins={REMARK_PLUGINS}
                shikiTheme={codeTheme}
                mode={isStreaming ? 'streaming' : 'static'}
                isAnimating={isStreaming}
                animated={isStreaming ? { animation: 'slideUp', sep: 'word', stagger: 30, duration: 200 } : undefined}
                parseIncompleteMarkdown={isStreaming}
                caret="block"
                mermaid={{ config: { startOnLoad: false, securityLevel: 'strict' } }}
                lineNumbers={false}
                controls={false}
              >
                {stripSkillOutputBlock(cleanText)}
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

const MessageBubble = memo(function MessageBubble({ message, onOpenFile, onSelectText, workspacePath, context }: MessageBubbleProps): React.ReactElement {
  const codeTheme = useCodeTheme()

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
      return <UserBubble text={message.textContent} messageId={message.id} onSelectText={onSelectText} context={context} />

    case 'text':
      return (
        <AssistantBubble message={message} codeTheme={codeTheme} onSelectText={onSelectText} context={context} />
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
