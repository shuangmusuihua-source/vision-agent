import { useState, useEffect, useCallback, memo } from 'react'
import { Clock, MessageCircle, Loader2 } from 'lucide-react'
import MessageBubble from '../chat/MessageBubble'
import type { SdkSessionInfo, ConversationMessage, ArtifactData, ArtifactFileType } from '../../../shared/types'
import './SessionHistoryPanel.css'

const FORMAT_DATE = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format

function formatTime(ts?: number): string {
  if (!ts) return ''
  return FORMAT_DATE(new Date(ts))
}

type RawSdkMsg = Record<string, unknown>

// ─── Artifact extraction (mirrors agent-store-impl.ts) ───

function extractSkillOutputContent(text: string): string | null {
  const match = text.match(/```skill-output\n([\s\S]*?)```/)
  if (match) return match[1]
  const partial = text.match(/```skill-output\n([\s\S]*)$/)
  if (partial) return partial[1]
  return null
}

function fileTypeFromExt(filePath: string): ArtifactFileType {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'json') return 'json'
  return 'md'
}

function fileTypeFromContent(content: string): ArtifactFileType {
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html'
  if (trimmed.startsWith('<svg')) return 'svg'
  return 'md'
}

function extractArtifact(msg: ConversationMessage): ArtifactData | null {
  if (msg.kind !== 'text') return null
  const skillContent = extractSkillOutputContent(msg.textContent)
  if (skillContent) {
    const writeTool = msg.toolCalls.find(
      (tc) => (tc.toolName === 'Write' || tc.toolName === 'Edit') && tc.status === 'completed'
    )
    const filePath = (writeTool?.input as Record<string, unknown>)?.file_path as string | undefined
    const fileType = filePath ? fileTypeFromExt(filePath) : fileTypeFromContent(skillContent)
    return {
      fileName: filePath ? filePath.split('/').pop()! : `artifact-${msg.id.slice(-6)}.${fileType}`,
      fileType,
      filePath,
      content: skillContent,
    }
  }

  const writeTool = msg.toolCalls.find(
    (tc) => (tc.toolName === 'Write' || tc.toolName === 'Edit') && tc.status === 'completed'
  )
  if (writeTool) {
    const filePath = (writeTool.input as Record<string, unknown>)?.file_path as string
    if (filePath) {
      return { fileName: filePath.split('/').pop() || 'artifact', fileType: fileTypeFromExt(filePath), filePath }
    }
  }

  return null
}

function toConversationMessages(msgs: RawSdkMsg[]): ConversationMessage[] {
  const result: ConversationMessage[] = []

  for (const msg of msgs) {
    const type = msg.type as string
    if (type === 'assistant') {
      const apiMessage = msg.message as RawSdkMsg | undefined
      const content = (apiMessage?.content as Array<RawSdkMsg>) || []
      const textBlocks = content.filter((b) => b.type === 'text')
      const toolBlocks = content.filter((b) => b.type === 'tool_use')
      const textContent = textBlocks.map((b) => (b.text as string) || '').join('')

      result.push({
        kind: 'text' as const,
        id: (msg.uuid as string) || `a-${result.length}`,
        role: 'assistant',
        phase: 'complete' as const,
        textContent,
        content: content as any,
        toolCalls: toolBlocks.map((tu) => ({
          toolUseId: (tu.id as string) || '',
          toolName: (tu.name as string) || '',
          input: (tu.input as Record<string, unknown>) || {},
          status: 'completed' as const,
        })),
        createdAt: Date.now(),
      })
    } else if (type === 'user') {
      const apiMessage = msg.message as RawSdkMsg | undefined
      const content = (apiMessage?.content as Array<RawSdkMsg>) || []
      const toolResults = content.filter((b) => b.type === 'tool_result')
      const textBlocks = content.filter((b) => b.type === 'text')

      // Attach tool results to the matching assistant message's tool calls
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const toolUseId = tr.tool_use_id as string
          const resultContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? (tr.content as Array<RawSdkMsg>).map((c) => (c.text as string) || '').join('')
              : ''
          const isError = tr.is_error === true

          // Find the last assistant message with this tool call
          for (let i = result.length - 1; i >= 0; i--) {
            const m = result[i]
            if (m.kind !== 'text') continue
            const tcIdx = m.toolCalls.findIndex((tc) => tc.toolUseId === toolUseId)
            if (tcIdx >= 0) {
              const updated = [...m.toolCalls]
              updated[tcIdx] = {
                ...updated[tcIdx],
                result: resultContent,
                status: isError ? 'error' as const : 'completed' as const,
              }
              result[i] = { ...m, toolCalls: updated }
              break
            }
          }
        }
      }

      const textContent = textBlocks.map((b) => (b.text as string) || '').join('')
      if (textContent) {
        result.push({
          kind: 'user' as const,
          id: (msg.uuid as string) || `u-${result.length}`,
          role: 'user',
          textContent,
          createdAt: Date.now(),
        })
      }
    }
  }

  // Extract artifacts from messages with Write/Edit results
  const withArtifacts: ConversationMessage[] = []
  for (let i = 0; i < result.length; i++) {
    withArtifacts.push(result[i])
    const artifact = extractArtifact(result[i])
    if (artifact) {
      withArtifacts.push({
        kind: 'artifact' as const,
        id: `artifact-${result[i].id}`,
        role: 'assistant',
        artifact,
        createdAt: Date.now(),
      })
    }
  }

  return withArtifacts
}

// Separate component — React.memo prevents re-renders since messages are static
const SessionDetail = memo(function SessionDetail({ messages }: { messages: ConversationMessage[] }) {
  return (
    <div className="shp-detail-scroll">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          context="editor"
          isLastMessage={false}
        />
      ))}
    </div>
  )
})

function SessionHistoryPanel(): React.ReactElement {
  const [sessions, setSessions] = useState<SdkSessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.agent.listSdkSessions()
      setSessions(list)
    } catch (err) {
      console.error('[SessionHistory] loadSessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id)
    setLoadingMessages(true)
    try {
      const msgs = await window.api.agent.loadSessionMessages(id)
      setMessages(toConversationMessages(msgs as RawSdkMsg[]))
    } catch (err) {
      console.error('[SessionHistory] loadMessages:', err)
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  return (
    <div className="session-history-panel">
      <div className="shp-body">
        {/* Left: session list */}
        <div className="shp-list">
          {loading ? (
            <div className="shp-list-loading">
              <Loader2 size={20} className="spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="shp-list-empty">暂无历史会话</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`shp-list-item${selectedId === s.id ? ' shp-list-item-active' : ''}`}
                onClick={() => handleSelect(s.id)}
              >
                <MessageCircle size={14} />
                <div className="shp-list-item-text">
                  <span className="shp-list-item-title">{s.title || s.id.slice(0, 12)}</span>
                  <span className="shp-list-item-time">{formatTime(s.lastModified || s.createdAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right: conversation detail */}
        <div className="shp-detail">
          {!selectedId ? (
            <div className="shp-detail-empty">
              <Clock size={32} />
              <span>选择左侧会话查看详情</span>
            </div>
          ) : loadingMessages ? (
            <div className="shp-detail-loading">
              <Loader2 size={20} className="spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="shp-detail-empty">
              <MessageCircle size={32} />
              <span>此会话无消息</span>
            </div>
          ) : (
            <SessionDetail messages={messages} />
          )}
        </div>
      </div>
    </div>
  )
}

export default SessionHistoryPanel
