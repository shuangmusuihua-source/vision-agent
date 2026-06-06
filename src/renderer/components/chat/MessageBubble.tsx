import { useState, useCallback, useEffect, useRef, memo, useSyncExternalStore } from 'react'
import { Streamdown } from 'streamdown'
import type { DiagramPlugin } from 'streamdown'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import mermaid from 'mermaid'
import remarkGfm from 'remark-gfm'
import { FileText, FileCode, ExternalLink, MessageSquareText, Download, CircleStop } from 'lucide-react'
import type { ConversationMessage, TextMessage, ArtifactData } from '../../../shared/types'
import type { BundledTheme } from 'shiki'
import { useAgentStore } from '../../store/agent-store-impl'
import ToolCallDisplay from './ToolCallDisplay'
import SkillOutputCard from './SkillOutputCard'
import { ComponentRenderer, extractJsonRenderBlocks } from './ComponentRender'

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

const ATTACH_REGEX = /^(📄|🖼️|📕)\s+(.+?)[：:]\s*(.+)$/

function parseAttachments(text: string): { attachments: string[]; body: string } {
  const lines = text.split('\n')
  const attachments: string[] = []
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (ATTACH_REGEX.test(lines[i])) {
      attachments.push(lines[i])
      bodyStart = i + 1
    } else {
      break
    }
  }
  return { attachments, body: lines.slice(bodyStart).join('\n').trimStart() }
}

function UserBubble({ text, onSelectText, context }: {
  text: string
  onSelectText?: (text: string, context?: string) => void
  context: string
}) {
  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const { attachments, body } = parseAttachments(text)

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
            <div className="message-attach-chips">
              {attachments.map((att, i) => {
                const match = att.match(ATTACH_REGEX)
                const icon = match?.[1] || '📄'
                const label = match?.[2] || ''
                const name = match?.[3] || att
                return (
                  <span key={i} className="message-attach-chip">
                    <span className="message-attach-chip-icon">{icon}</span>
                    <span className="message-attach-chip-label">{label}</span>
                    <span className="message-attach-chip-name">{name}</span>
                  </span>
                )
              })}
            </div>
            {body && <div className="message-user-text">{body}</div>}
          </>
        ) : (
          text
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
        {showSkillOutput && (
          <SkillOutputCard content={skillOutput.content} isStreaming={skillOutput.isStreaming} language={skillOutput.language} />
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
                mermaid={{ config: { startOnLoad: false } }}
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
}, (prev, next) => {
  // Skip re-render if nothing visible changed (reduces jank during streaming)
  const a = prev.message, b = next.message
  if (a.id !== b.id) return false
  if (a.kind !== b.kind) return false
  if (prev.isLastMessage !== next.isLastMessage) return false
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
