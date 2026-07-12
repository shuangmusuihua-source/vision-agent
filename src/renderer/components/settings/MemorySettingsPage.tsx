import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Clock3, FileText, Globe2, HardDrive, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { MemoryDocument, MemoryEntry } from '../../lib/ipc'
import { useModal } from '../common/ModalSystem'
import './MemorySettingsPage.css'

const AssistantMarkdown = lazy(() => import('../chat/AssistantMarkdown'))

interface MemorySettingsPageProps {
  onDirtyChange: (dirty: boolean) => void
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
}

export function memoryPreviewMarkdown(content: string): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return withoutFrontmatter.trim() || '*（空记忆）*'
}

function MemorySettingsPage({ onDirtyChange }: MemorySettingsPageProps): React.ReactElement {
  const modal = useModal()
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [document, setDocument] = useState<MemoryDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isDocumentLoading, setIsDocumentLoading] = useState(false)
  const [documentRevision, setDocumentRevision] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)

  const dirty = isEditing && document !== null && draft !== document.content

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
  }, [])

  const showFeedback = useCallback((message: string) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    setFeedback(message)
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null)
      feedbackTimerRef.current = null
    }, 1800)
  }, [])

  const loadEntries = useCallback(async (preferredPath?: string | null): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      const nextEntries = await window.api.memory.list()
      setEntries(nextEntries)
      setSelectedPath((current) => {
        const candidate = preferredPath === undefined ? current : preferredPath
        return candidate && nextEntries.some((entry) => entry.path === candidate)
          ? candidate
          : nextEntries[0]?.path || null
      })
      if (nextEntries.length === 0) setDocument(null)
      return true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取记忆列表')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void loadEntries() }, [loadEntries])

  useEffect(() => {
    if (!selectedPath) {
      setDocument(null)
      return
    }
    let cancelled = false
    setError(null)
    setIsDocumentLoading(true)
    window.api.memory.read(selectedPath).then((result) => {
      if (cancelled) return
      if (!result.success || !result.document) {
        setDocument(null)
        setError(result.error || '无法读取记忆内容')
        return
      }
      setDocument(result.document)
      setDraft(result.document.content)
      setIsEditing(false)
    }).catch((readError) => {
      if (!cancelled) {
        setDocument(null)
        setError(readError instanceof Error ? readError.message : '无法读取记忆内容')
      }
    }).finally(() => {
      if (!cancelled) setIsDocumentLoading(false)
    })
    return () => { cancelled = true }
  }, [documentRevision, selectedPath])

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    return modal.confirm({
      title: '放弃未保存的修改？',
      message: '切换后，当前记忆中尚未保存的内容会丢失。',
      confirmLabel: '放弃修改',
      variant: 'danger',
    })
  }, [dirty, modal])

  const handleSelect = useCallback(async (path: string) => {
    if (path === selectedPath || !await confirmDiscard()) return
    setDocument(null)
    setSelectedPath(path)
  }, [confirmDiscard, selectedPath])

  const handleRefresh = useCallback(async () => {
    if (!await confirmDiscard()) return
    setIsEditing(false)
    if (await loadEntries(selectedPath)) {
      setDocument(null)
      setDocumentRevision((revision) => revision + 1)
    }
  }, [confirmDiscard, loadEntries, selectedPath])

  const handleSave = useCallback(async () => {
    if (!document || !dirty) return
    setIsSaving(true)
    setError(null)
    try {
      const result = await window.api.memory.update(document.path, draft)
      if (!result.success || !result.document) {
        setError(result.error || '无法保存记忆')
        return
      }
      const savedDocument = result.document
      setDocument(savedDocument)
      setDraft(savedDocument.content)
      setEntries((current) => current.map((entry) => entry.path === savedDocument.path
        ? savedDocument
        : entry))
      setIsEditing(false)
      showFeedback('已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '无法保存记忆')
    } finally {
      setIsSaving(false)
    }
  }, [document, draft, dirty, showFeedback])

  const handleCancel = useCallback(() => {
    if (!document) return
    setDraft(document.content)
    setIsEditing(false)
  }, [document])

  const handleDelete = useCallback(async () => {
    if (!document) return
    const confirmed = await modal.confirm({
      title: document.kind === 'index' ? '删除记忆索引' : '删除记忆',
      message: document.kind === 'index'
        ? '确定删除 MEMORY.md 吗？Claude 将无法在会话启动时发现现有主题记忆，之后可能重新创建索引。此操作不可撤销。'
        : `确定删除“${document.name}”吗？此操作不可撤销。`,
      confirmLabel: '删除',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      const result = await window.api.memory.delete(document.path)
      if (!result.success) {
        setError(result.error || '无法删除记忆')
        return
      }
      setIsEditing(false)
      setDocument(null)
      await loadEntries(null)
      showFeedback('已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '无法删除记忆')
    }
  }, [document, loadEntries, modal, showFeedback])

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedPath) || null,
    [entries, selectedPath],
  )

  return (
    <div className="memory-settings-page">
      {error && (
        <div className="memory-settings-error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={13} /></button>
        </div>
      )}
      {feedback && <div className="memory-settings-feedback" role="status" aria-live="polite">{feedback}</div>}

      <div className="memory-settings-browser">
        <aside className="memory-settings-list" aria-label="记忆列表">
          <div className="memory-settings-list-heading">
            <span>全部记忆</span>
            <div>
              <strong>{entries.length}</strong>
              <button className="memory-icon-button" type="button" onClick={() => void handleRefresh()} aria-label="刷新记忆" title="刷新记忆" disabled={isLoading || isDocumentLoading}>
                <RefreshCw size={14} className={isLoading ? 'is-spinning' : undefined} />
              </button>
            </div>
          </div>
          <div className="memory-settings-list-scroll">
            {isLoading && entries.length === 0 ? (
              <div className="memory-settings-list-state">正在读取…</div>
            ) : entries.length === 0 ? (
              <div className="memory-settings-list-state">还没有可管理的记忆</div>
            ) : entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`memory-settings-list-item${selectedPath === entry.path ? ' active' : ''}`}
                onClick={() => void handleSelect(entry.path)}
                title={entry.path}
              >
                <FileText size={15} />
                <span>
                  <strong>{entry.name}</strong>
                  <small>{entry.kind === 'index' ? '全局索引 · 会话启动时加载' : '全局主题 · 按需读取'}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="memory-settings-detail" aria-label="记忆详情">
          {!selectedEntry || !document || document.path !== selectedPath ? (
            <div className="memory-settings-empty">
              <FileText size={22} />
              <span>{isLoading || isDocumentLoading ? '正在读取记忆…' : '选择一条记忆查看内容'}</span>
            </div>
          ) : (
            <>
              <header className="memory-settings-detail-header">
                <div className="memory-settings-detail-title">
                  <h3>{document.name}</h3>
                  <span>{document.kind === 'index' ? '全局记忆索引' : '全局主题记忆'}</span>
                </div>
                <div className="memory-settings-actions">
                  {isEditing ? (
                    <>
                      <button type="button" className="memory-action-button" onClick={handleCancel}>取消</button>
                      <button type="button" className="memory-action-button primary" onClick={() => void handleSave()} disabled={!dirty || isSaving}>
                        <Save size={14} />{isSaving ? '保存中' : '保存'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="memory-action-button" onClick={() => setIsEditing(true)}>
                      <Pencil size={14} />编辑
                    </button>
                  )}
                  <button type="button" className="memory-action-button danger" onClick={() => void handleDelete()}>
                    <Trash2 size={14} />删除
                  </button>
                </div>
              </header>

              <div className="memory-settings-meta">
                <span><Globe2 size={13} />所有工作区共享</span>
                <span><Clock3 size={13} />{formatDate(document.modifiedAt)}</span>
                <span><HardDrive size={13} />{formatSize(document.size)}</span>
              </div>

              {isEditing ? (
                <textarea
                  className="memory-settings-editor"
                  aria-label={`编辑记忆 ${document.name}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              ) : (
                <div className="memory-settings-preview">
                  <Suspense fallback={<div className="memory-settings-rendering">正在渲染…</div>}>
                    <AssistantMarkdown text={memoryPreviewMarkdown(document.content)} isStreaming={false} />
                  </Suspense>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default MemorySettingsPage
