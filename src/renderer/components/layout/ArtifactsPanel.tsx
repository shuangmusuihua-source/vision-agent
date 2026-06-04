import { useState, useEffect, useCallback } from 'react'
import { Box, FileCode, FileText, Image, FileJson, File, CodeXml, Loader2, Trash2 } from 'lucide-react'
import type { ComponentType } from 'react'
import './ArtifactsPanel.css'

interface ArtifactEntry {
  fileName: string
  fileType: 'html' | 'svg' | 'json' | 'md' | 'pdf' | 'other'
  filePath?: string
  sessionId: string
  sessionTitle: string
  createdAt: string
}

function fileTypeFromPath(p: string): ArtifactEntry['fileType'] {
  const ext = p.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'json') return 'json'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md') return 'md'
  return 'other'
}

const TYPE_ICONS: Record<string, React.ComponentType<{ size: number }>> = {
  html: CodeXml, svg: Image, json: FileJson, md: FileText, pdf: File,
}

const TYPE_COLORS: Record<string, string> = {
  html: '#e34c26', svg: '#ff9a00', json: '#f0db4f', md: '#42a5f5', pdf: '#ef4444',
}

async function discoverArtifacts(): Promise<ArtifactEntry[]> {
  const sessions = await window.api.agent.listSdkSessions()
  const results: ArtifactEntry[] = []
  const seen = new Set<string>()

  for (const s of sessions) {
    try {
      const msgs = await window.api.agent.loadSessionMessages(s.id)
      for (const msg of msgs as Array<Record<string, unknown>>) {
        const type = msg.type as string
        // Check assistant messages for Write/Edit tool_use
        if (type === 'assistant') {
          const apiMsg = msg.message as Record<string, unknown> | undefined
          const content = (apiMsg?.content as Array<Record<string, unknown>>) || []
          for (const block of content) {
            if ((block.type as string) === 'tool_use') {
              const name = (block.name as string) || ''
              if (name === 'Write' || name === 'Edit') {
                const input = block.input as Record<string, unknown> | undefined
                const fp = (input?.file_path as string) || ''
                if (fp && !seen.has(fp)) {
                  seen.add(fp)
                  results.push({
                    fileName: fp.split('/').pop() || fp,
                    fileType: fileTypeFromPath(fp),
                    filePath: fp,
                    sessionId: s.id,
                    sessionTitle: s.title || s.id.slice(0, 12),
                    createdAt: s.lastModified
                      ? new Date(s.lastModified).toLocaleDateString('zh-CN')
                      : '',
                  })
                }
              }
            }
          }
        }
      }
    } catch {
      // Skip sessions that fail to load
    }
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

interface ArtifactsPanelProps {
  onOpenFile?: (path: string) => void
}

function ArtifactsPanel({ onOpenFile }: ArtifactsPanelProps): React.ReactElement {
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await discoverArtifacts()
      setArtifacts(list)
    } catch (err) {
      console.error('[ArtifactsPanel] load:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleOpen = (a: ArtifactEntry) => {
    if (!a.filePath) return
    if (a.fileType === 'md' && onOpenFile) {
      onOpenFile(a.filePath)
    } else {
      window.api.workspace.openInBrowser(a.filePath)
    }
  }

  const handleDelete = useCallback(async (a: ArtifactEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!a.filePath) return
    try {
      await window.api.workspace.deleteFile(a.filePath)
      setArtifacts((prev) => prev.filter((x) => x.filePath !== a.filePath))
    } catch (err) {
      console.error('[ArtifactsPanel] delete:', err)
    }
  }, [])

  // Group by date
  const grouped = new Map<string, ArtifactEntry[]>()
  for (const a of artifacts) {
    const key = a.createdAt || '未知日期'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(a)
  }

  return (
    <div className="artifacts-panel">
      <div className="artifacts-panel-body">
        {loading ? (
          <div className="artifacts-panel-loading">
            <Loader2 size={20} className="spin" />
          </div>
        ) : artifacts.length === 0 ? (
          <div className="artifacts-panel-empty">
            <FileCode size={32} />
            <span>暂无产物</span>
            <span className="artifacts-panel-empty-hint">执行 skill 后产物会出现在这里</span>
          </div>
        ) : (
          [...grouped.entries()].map(([date, items]) => (
            <div key={date} className="artifacts-panel-group">
              <div className="artifacts-panel-date">{date}</div>
              <div className="artifacts-panel-grid">
                {items.map((a, i) => {
                  const Icon = TYPE_ICONS[a.fileType] || File
                  const accent = TYPE_COLORS[a.fileType] || '#9ca3af'
                  return (
                  <button key={i} className="artifacts-card" onClick={() => handleOpen(a)} title={a.filePath}>
                    <button className="artifacts-card-delete" onClick={(e) => handleDelete(a, e)} title="删除">
                      <Trash2 size={12} />
                    </button>
                    <span className="artifacts-card-icon" style={{ color: accent }}><Icon size={20} /></span>
                    <span className="artifacts-card-name">{a.fileName}</span>
                    <span className="artifacts-card-meta">
                      <span className="artifacts-card-session">{a.sessionTitle}</span>
                    </span>
                  </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ArtifactsPanel
