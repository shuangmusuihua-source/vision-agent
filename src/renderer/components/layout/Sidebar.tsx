import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronDown, ChevronsUp, X, Search, Settings, GitGraph, Plus, Pin, Eye, Ellipsis, ArrowLeft, Clock, Box, MessageCircle, Loader2, Trash2 } from 'lucide-react'
import { Flipper, Flipped } from 'react-flip-toolkit'
import { useModal } from '../common/ModalSystem'
import { useAgentStore } from '../../store/agent-store-impl'
import type { SdkSessionInfo } from '../../../shared/types'

interface MemoryEntry {
  name: string
  path: string
}

interface SidebarProps {
  workspacePaths: string[]
  fixedWorkspacePaths: string[]
  memoryRefreshKey: number
  sessions: SdkSessionInfo[]
  activeSessionId: string | null
  activeSessionRunning: boolean
  onSessionSelect: (sessionId: string, workspacePath: string) => void
  onDeleteSession: (sessionId: string, workspacePath: string) => void
  onNewConversation: (workspacePath: string) => void
  onCancelNewSession: () => void
  creatingSessionIn: string | null
  newSessionName: string
  onNewSessionNameChange: (name: string) => void
  onCreateSession: (wsPath: string) => void
  newSessionInputRef: React.RefObject<HTMLInputElement | null>
  onNewWorkspace: () => void
  onRemoveWorkspace: (path: string) => void
  onRefreshWorkspace: (path: string) => void
  onReorderWorkspaces: (paths: string[]) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleGraph: () => void
  onDaydream: (mode: string) => void
  onAskZuovis: () => void
  onAskZuovisBack: () => void
  isAskZuovisActive: boolean
  isAskZuovisInChat: boolean
  isAskZuovisRunning: boolean
  onSessionHistory: () => void
  isSessionHistoryActive: boolean
  onArtifacts: () => void
  isArtifactsActive: boolean
  showGraph: boolean
  changedFileCount: number
  collapsed: boolean
}

function SidebarBackButton({ running, onBack }: { running: boolean; onBack: () => void }) {
  const [clickedOnce, setClickedOnce] = useState(false)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (running && !clickedOnce) {
      setClickedOnce(true)
      return
    }
    setClickedOnce(false)
    onBack()
  }

  return (
    <div
      className={`sidebar-ask-zuovis-back-wrap${running ? ' sidebar-ask-zuovis-back-wrap--warn' : ''}${clickedOnce ? ' sidebar-ask-zuovis-back-wrap--clicked' : ''}`}
    >
      <button
        className="sidebar-ask-zuovis-back"
        onClick={handleClick}
        title={running ? '返回将中止当前任务' : '返回首页'}
        aria-label="返回首页"
      >
        <ArrowLeft size={12} />
      </button>
      {running && (
        <div className="sidebar-ask-zuovis-back-tip">
          {clickedOnce ? '再次点击确认返回' : '返回将中止当前任务'}
        </div>
      )}
    </div>
  )
}

function formatSessionTime(ts?: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function Sidebar({
  workspacePaths,
  fixedWorkspacePaths,
  memoryRefreshKey,
  sessions,
  activeSessionId,
  activeSessionRunning,
  onSessionSelect,
  onDeleteSession,
  onNewConversation,
  onCancelNewSession,
  creatingSessionIn,
  newSessionName,
  onNewSessionNameChange,
  onCreateSession,
  newSessionInputRef,
  onNewWorkspace,
  onRemoveWorkspace,
  onRefreshWorkspace,
  onReorderWorkspaces,
  onOpenSettings,
  onOpenSearch,
  onToggleGraph,
  onDaydream,
  onAskZuovis,
  onAskZuovisBack,
  isAskZuovisActive,
  isAskZuovisInChat,
  isAskZuovisRunning,
  onSessionHistory,
  isSessionHistoryActive,
  onArtifacts,
  isArtifactsActive,
  showGraph,
  changedFileCount,
  collapsed
}: SidebarProps): React.ReactElement {
  const modal = useModal()
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [memoryFiles, setMemoryFiles] = useState<MemoryEntry[]>([])
  // Subscribe reactively to sessionSlots so non-active session state (running indicator, title)
  // triggers re-renders when slots are saved/restored on session switch.
  const sessionSlots = useAgentStore((s) => s.sessionSlots)

  const refreshMemory = useCallback(() => {
    window.api.memory.list().then(setMemoryFiles).catch(() => setMemoryFiles([]))
  }, [])

  useEffect(() => {
    refreshMemory()
  }, [memoryRefreshKey, refreshMemory])

  const handleDeleteMemory = useCallback(async (filePath: string) => {
    const ok = await modal.confirm({ title: '删除记忆', message: '确定删除此记忆文件？此操作不可撤销。', variant: 'danger' })
    if (!ok) return
    await window.api.memory.delete(filePath)
    refreshMemory()
  }, [refreshMemory])

  const toggleWorkspace = useCallback((path: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleCollapseAll = useCallback(() => {
    setCollapsedWorkspaces(new Set(workspacePaths))
  }, [workspacePaths])

  const handlePinToTop = useCallback((wsPath: string) => {
    const idx = workspacePaths.indexOf(wsPath)
    if (idx <= 0) return
    const reordered = [...workspacePaths]
    reordered.splice(idx, 1)
    reordered.unshift(wsPath)
    onReorderWorkspaces(reordered)
  }, [workspacePaths, onReorderWorkspaces])

  const workspaceName = (path: string) => path.split('/').pop() || path

  // Group sessions by workspacePath
  const sessionsByWorkspace: Record<string, SdkSessionInfo[]> = {}
  for (const s of sessions) {
    const wsPath = s.workspacePath || s.cwd || ''
    if (!sessionsByWorkspace[wsPath]) sessionsByWorkspace[wsPath] = []
    sessionsByWorkspace[wsPath].push(s)
  }

  const [showDaydreamPicker, setShowDaydreamPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState({ left: 0, top: 0 })
  const daydreamBtnRef = useRef<HTMLButtonElement>(null)

  const togglePicker = () => {
    if (!showDaydreamPicker && daydreamBtnRef.current) {
      const rect = daydreamBtnRef.current.getBoundingClientRect()
      setPickerPos({ left: rect.left, top: rect.bottom + 6 })
    }
    setShowDaydreamPicker(v => !v)
  }

  useEffect(() => {
    if (!showDaydreamPicker) return
    const handler = (e: MouseEvent) => {
      if (daydreamBtnRef.current && daydreamBtnRef.current.contains(e.target as Node)) return
      const picker = document.querySelector('.daydream-picker')
      if (picker && picker.contains(e.target as Node)) return
      setShowDaydreamPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDaydreamPicker])

  return (
    <>
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button className="sidebar-icon-btn" onClick={onOpenSearch} title="搜索" aria-label="搜索">
            <Search size={16} />
          </button>
          <button className={`sidebar-icon-btn${showGraph ? ' sidebar-icon-btn-active' : ''}`} onClick={onToggleGraph} title="图谱视图" aria-label="图谱视图">
            <GitGraph size={16} />
            {changedFileCount >= 2 && <span className="sidebar-badge-dot" />}
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置" aria-label="设置">
            <Settings size={16} />
          </button>
          <button ref={daydreamBtnRef} className="sidebar-icon-btn" onClick={togglePicker} title="心休模式" aria-label="心休模式">
            <Eye size={16} />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {/* Ask Zuovis */}
        <div
          className={`sidebar-ask-zuovis${isAskZuovisActive ? ' sidebar-ask-zuovis-active' : ''}`}
          onClick={onAskZuovis}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAskZuovis() } }}
        >
          <div className="sidebar-ask-zuovis-icon"><Ellipsis size={12} /></div>
          <span className="sidebar-ask-zuovis-label">Ask Zuovis</span>
          {isAskZuovisActive && isAskZuovisInChat && (
            <SidebarBackButton running={isAskZuovisRunning} onBack={onAskZuovisBack} />
          )}
        </div>

        <div
          className={`sidebar-ask-zuovis${isSessionHistoryActive ? ' sidebar-ask-zuovis-active' : ''}`}
          onClick={onSessionHistory}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSessionHistory() } }}
        >
          <div className="sidebar-history-icon"><Clock size={12} /></div>
          <span className="sidebar-ask-zuovis-label">历史会话</span>
        </div>

        <div
          className={`sidebar-ask-zuovis${isArtifactsActive ? ' sidebar-ask-zuovis-active' : ''}`}
          onClick={onArtifacts}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onArtifacts() } }}
        >
          <div className="sidebar-history-icon sidebar-artifacts-icon"><Box size={12} /></div>
          <span className="sidebar-ask-zuovis-label">产物</span>
        </div>

        {/* Workspaces with sessions */}
        {workspacePaths.filter(p => !fixedWorkspacePaths.includes(p)).length > 0 && (
          <div className="sidebar-workspace-module-header">
            <span className="sidebar-workspace-module-title">工作区</span>
            <div className="sidebar-workspace-module-actions">
              <button className="sidebar-workspace-module-btn" onClick={handleCollapseAll} title="全部收起" aria-label="全部收起">
                <ChevronsUp size={12} />
              </button>
              <button className="sidebar-workspace-module-btn" onClick={onNewWorkspace} title="新建工作区" aria-label="新建工作区">
                <Plus size={12} />
              </button>
            </div>
          </div>
        )}
        {workspacePaths.filter(p => !fixedWorkspacePaths.includes(p)).length === 0 ? (
          <div className="sidebar-empty-workspace">
            <button className="sidebar-new-dir-btn" onClick={onNewWorkspace}>
              新建工作区
            </button>
          </div>
        ) : (
          <Flipper
            flipKey={workspacePaths.filter(p => !fixedWorkspacePaths.includes(p)).join(',')}
            spring={{ stiffness: 200, damping: 28 } as any}
            className="sidebar-workspace-list"
          >
            {workspacePaths.filter(p => !fixedWorkspacePaths.includes(p)).map((wsPath, idx) => {
              const isCollapsed = collapsedWorkspaces.has(wsPath)
              const wsSessions = (sessionsByWorkspace[wsPath] || [])
                .sort((a, b) => (b.lastModified || b.createdAt || 0) - (a.lastModified || a.createdAt || 0))

              return (
                <Flipped key={wsPath} flipId={wsPath}>
                  <div className={`sidebar-workspace-section${isCollapsed ? ' sidebar-workspace-collapsed' : ''}`}>
                    <div className="sidebar-workspace-header">
                      <button
                        className="sidebar-workspace-toggle"
                        onClick={() => toggleWorkspace(wsPath)}
                        aria-label={isCollapsed ? '展开工作区' : '折叠工作区'}
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <span className="sidebar-workspace-name">{workspaceName(wsPath)}</span>
                      <button
                        className="sidebar-workspace-add-session"
                        onClick={(e) => { e.stopPropagation(); onNewConversation(wsPath) }}
                        title="新建会话" aria-label="新建会话"
                      >
                        <Plus size={12} />
                      </button>
                      {idx > 0 && (
                        <button
                          className="sidebar-workspace-pin"
                          onClick={() => handlePinToTop(wsPath)}
                          title="置顶" aria-label="置顶"
                        >
                          <Pin size={12} />
                        </button>
                      )}
                      <button
                        className="sidebar-workspace-remove"
                        onClick={() => onRemoveWorkspace(wsPath)}
                        title="移除工作区" aria-label="移除工作区"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="sidebar-workspace-body">
                        {/* Session list */}
                        {wsSessions.length === 0 && creatingSessionIn !== wsPath ? (
                          <div className="sidebar-session-empty">暂无会话</div>
                        ) : (
                          wsSessions.map((session) => {
                            // Running: prefer activeSessionRunning for the active session (reactive via prop),
                            // fall back to sessionSlots for non-active sessions (saved on switch-away)
                            const isActive = activeSessionId === session.id
                            const slot = isActive ? null : sessionSlots[session.id]
                            const isRunning = isActive
                              ? activeSessionRunning
                              : (slot?.isStreaming || (slot?.agentState && slot.agentState !== 'idle' && slot.agentState !== 'error'))
                            return (
                              <div
                                key={session.id}
                                className={`sidebar-entry sidebar-session-entry${activeSessionId === session.id ? ' sidebar-entry-active' : ''}`}
                                onClick={() => onSessionSelect(session.id, wsPath)}
                              >
                                {renamingId === session.id ? (
                                  <input
                                    ref={renameInputRef}
                                    className="sidebar-new-file-field"
                                    style={{ flex: 1, fontSize: 13 }}
                                    value={renameText}
                                    onChange={(e) => setRenameText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.isComposing) {
                                        const name = renameText.trim()
                                        if (name) useAgentStore.getState().renameCurrentSession(name)
                                        setRenamingId(null)
                                      }
                                      if (e.key === 'Escape') setRenamingId(null)
                                    }}
                                    onBlur={() => {
                                      const name = renameText.trim()
                                      if (name) useAgentStore.getState().renameCurrentSession(name)
                                      setRenamingId(null)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <span
                                    className="sidebar-session-title"
                                    onDoubleClick={(e) => {
                                      e.stopPropagation()
                                      setRenamingId(session.id)
                                      setRenameText(session.title || '')
                                      setTimeout(() => renameInputRef.current?.select(), 0)
                                    }}
                                    title="双击重命名"
                                  >
                                    {session.title || session.id?.slice(-8) || '未命名会话'}
                                  </span>
                                )}
                                {!isRunning && (
                                  <span className="sidebar-session-time">
                                    {formatSessionTime(session.lastModified || session.createdAt)}
                                  </span>
                                )}
                                <button
                                  className="sidebar-session-delete"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onDeleteSession(session.id, wsPath)
                                  }}
                                  title="删除会话"
                                  aria-label="删除会话"
                                >
                                  <Trash2 size={11} />
                                </button>
                                {isRunning && <Loader2 size={12} className="sidebar-session-running" />}
                              </div>
                            )
                          })
                        )}
                        {/* New session name input */}
                        {creatingSessionIn === wsPath && (
                          <div className="sidebar-new-file-input">
                            <input
                              ref={newSessionInputRef}
                              className="sidebar-new-file-field"
                              placeholder="会话名称"
                              value={newSessionName}
                              onChange={(e) => onNewSessionNameChange(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.isComposing) onCreateSession(wsPath)
                                if (e.key === 'Escape') { onNewSessionNameChange(''); onCancelNewSession() }
                              }}
                              onBlur={() => {
                                if (!newSessionName.trim()) {
                                  onCancelNewSession()
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Flipped>
              )
            })}
          </Flipper>
        )}

        <div className="sidebar-section-divider" />

        {/* Knowledge — fixed file tree */}
        {fixedWorkspacePaths.map((wsPath) => {
          const isCollapsed = collapsedWorkspaces.has(wsPath)
          return (
            <div key={wsPath} className={`sidebar-workspace-section sidebar-workspace-fixed${isCollapsed ? ' sidebar-workspace-collapsed' : ''}`}>
              <div className="sidebar-workspace-module-header" onClick={() => toggleWorkspace(wsPath)} style={{ cursor: 'pointer' }}>
                <span className="sidebar-workspace-module-title">Knowledge</span>
                <div className="sidebar-workspace-module-actions">
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </div>
              </div>
            </div>
          )
        })}

        {/* Memory */}
        {memoryFiles.length > 0 && (
          <div className="sidebar-memory-section">
            <div className="sidebar-workspace-module-header" onClick={() => setMemoryExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
              <span className="sidebar-workspace-module-title">Memory</span>
              <div className="sidebar-workspace-module-actions">
                {memoryExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </div>
            </div>
            {memoryExpanded && memoryFiles.map((file) => (
              <div
                key={file.path}
                className="sidebar-entry sidebar-file sidebar-memory-entry"
                style={{ paddingLeft: 20 }}
              >
                <MessageCircle size={13} />
                <span className="sidebar-memory-name">{file.name}</span>
                <button
                  className="sidebar-memory-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteMemory(file.path)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {showDaydreamPicker && createPortal(
      <div className="daydream-picker" style={{ left: pickerPos.left, top: pickerPos.top }}>
        <div className="daydream-picker-title">心休模式</div>
        <button className="daydream-picker-item" onClick={() => { onDaydream('matrix'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview matrix-preview" />
          <span>数字矩阵</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('starfield'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview starfield-preview" />
          <span>星空夜语</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('math'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview math-preview" />
          <span>数理幻境</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('rain'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview rain-preview" />
          <span>绿野甘霖</span>
        </button>
      </div>,
      document.body
    )}
    </>
  )
}

export default Sidebar
