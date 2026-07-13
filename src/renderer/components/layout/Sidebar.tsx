import { useState, useRef, useCallback } from 'react'
import { ChevronsUp, X, Plus, Pin, Ellipsis, ArrowLeft, FolderClosed, FolderOpen, Loader2, Trash2, ShieldAlert, MessageCircleQuestion, Blocks, Workflow, BookOpenText } from 'lucide-react'
import { Flipper, Flipped } from 'react-flip-toolkit'
import { useAgentStore } from '../../store/agent-store-impl'
import { ASK_ASSISTANT_NAME } from '../../../shared/branding'
import { filterUserWorkspacePaths } from '../../../shared/workspace-paths'
import type { SdkSessionInfo } from '../../../shared/types'
import type { ContextSlot } from '../../store/agent-store'
import type { PrimaryView } from '../../store/ui-slice'
import SidebarToolDock from './SidebarToolDock'

interface SidebarProps {
  collapsed: boolean
  navigation: {
    view: PrimaryView
    open: (view: Exclude<PrimaryView, 'editor'>) => void
    ask: {
      hasConversation: boolean
      running: boolean
      back: () => void
    }
    changedFileCount: number
  }
  workspaces: {
    paths: string[]
    fixedPaths: string[]
    create: () => void
    remove: (path: string) => void
    reorder: (paths: string[]) => void
  }
  sessions: {
    items: SdkSessionInfo[]
    activeId: string | null
    activeRunning: boolean
    select: (sessionId: string, workspacePath: string) => void
    remove: (sessionId: string, workspacePath: string) => void
    rename: (sessionId: string, title: string) => Promise<void>
    draft: {
      workspacePath: string | null
      title: string
      inputRef: React.RefObject<HTMLInputElement | null>
      begin: (workspacePath: string) => void
      cancel: () => void
      change: (name: string) => void
      submit: (workspacePath: string) => void
    }
  }
  tools: {
    openSettings: () => void
    openSearch: () => void
    openDaydream: (mode: string) => void
  }
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

function getSessionAttention(slot?: ContextSlot | null): {
  type: 'permission' | 'askUser'
  count: number
  label: string
} | null {
  if (!slot) return null
  const permissionCount = (slot.permissionRequest ? 1 : 0) + slot.permissionQueue.length
  if (permissionCount > 0) {
    return { type: 'permission', count: permissionCount, label: '等待权限确认' }
  }

  const askUserCount = (slot.askUserRequest ? 1 : 0) + slot.askUserQueue.length
  if (askUserCount > 0) {
    return { type: 'askUser', count: askUserCount, label: '等待你回答' }
  }

  return null
}

function Sidebar({
  collapsed,
  navigation,
  workspaces,
  sessions: sessionModel,
  tools,
}: SidebarProps): React.ReactElement {
  const workspacePaths = workspaces.paths
  const fixedWorkspacePaths = workspaces.fixedPaths
  const onNewWorkspace = workspaces.create
  const onRemoveWorkspace = workspaces.remove
  const onReorderWorkspaces = workspaces.reorder
  const sessions = sessionModel.items
  const activeSessionId = sessionModel.activeId
  const activeSessionRunning = sessionModel.activeRunning
  const onSessionSelect = sessionModel.select
  const onDeleteSession = sessionModel.remove
  const onRenameSession = sessionModel.rename
  const creatingSessionIn = sessionModel.draft.workspacePath
  const newSessionName = sessionModel.draft.title
  const newSessionInputRef = sessionModel.draft.inputRef
  const onNewConversation = sessionModel.draft.begin
  const onCancelNewSession = sessionModel.draft.cancel
  const onNewSessionNameChange = sessionModel.draft.change
  const onCreateSession = sessionModel.draft.submit
  const onOpenSettings = tools.openSettings
  const onOpenSearch = tools.openSearch
  const onDaydream = tools.openDaydream
  const onAskZuovis = () => navigation.open('ask')
  const onOpenSkills = () => navigation.open('skills')
  const onOpenAutomation = () => navigation.open('automation')
  const onOpenKnowledge = () => navigation.open('knowledge')
  const onAskZuovisBack = navigation.ask.back
  const isAskZuovisActive = navigation.view === 'ask'
  const isSkillsActive = navigation.view === 'skills'
  const isAutomationActive = navigation.view === 'automation'
  const isKnowledgeActive = navigation.view === 'knowledge'
  const isAskZuovisInChat = navigation.ask.hasConversation
  const isAskZuovisRunning = navigation.ask.running
  const changedFileCount = navigation.changedFileCount
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const userWorkspacePaths = filterUserWorkspacePaths(workspacePaths, fixedWorkspacePaths)
  // Subscribe reactively to sessionSlots so non-active session state (running indicator, title)
  // triggers re-renders when slots are saved/restored on session switch.
  const sessionSlots = useAgentStore((s) => s.sessionSlots)

  const toggleWorkspace = useCallback((path: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleCollapseAll = useCallback(() => {
    setCollapsedWorkspaces(new Set(filterUserWorkspacePaths(workspacePaths, fixedWorkspacePaths)))
  }, [workspacePaths, fixedWorkspacePaths])

  const handlePinToTop = useCallback((wsPath: string) => {
    const userPaths = filterUserWorkspacePaths(workspacePaths, fixedWorkspacePaths)
    const idx = userPaths.indexOf(wsPath)
    if (idx <= 0) return
    const reordered = [...userPaths]
    reordered.splice(idx, 1)
    reordered.unshift(wsPath)
    onReorderWorkspaces(reordered)
  }, [workspacePaths, fixedWorkspacePaths, onReorderWorkspaces])

  const workspaceName = (path: string) => path.split('/').pop() || path

  // Group sessions by workspacePath
  const sessionsByWorkspace: Record<string, SdkSessionInfo[]> = {}
  for (const s of sessions) {
    const wsPath = s.workspacePath || s.cwd || ''
    if (!sessionsByWorkspace[wsPath]) sessionsByWorkspace[wsPath] = []
    sessionsByWorkspace[wsPath].push(s)
  }

  return (
    <>
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header" aria-hidden="true" />

      <div className="sidebar-content">
        <div className="sidebar-primary-nav" aria-label="主要功能">
          {/* Ask sumi */}
          <div
            className={`sidebar-ask-zuovis${isAskZuovisActive ? ' sidebar-ask-zuovis-active' : ''}`}
            onClick={onAskZuovis}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAskZuovis() } }}
          >
            <div className="sidebar-ask-zuovis-icon"><Ellipsis size={12} /></div>
            <span className="sidebar-ask-zuovis-label">Ask {ASK_ASSISTANT_NAME}</span>
            {isAskZuovisActive && isAskZuovisInChat && (
              <SidebarBackButton running={isAskZuovisRunning} onBack={onAskZuovisBack} />
            )}
          </div>

          <div
            className={`sidebar-ask-zuovis sidebar-skills-entry${isSkillsActive ? ' sidebar-ask-zuovis-active' : ''}`}
            onClick={onOpenSkills}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSkills() } }}
          >
            <div className="sidebar-ask-zuovis-icon sidebar-skills-icon"><Blocks size={13} /></div>
            <span className="sidebar-ask-zuovis-label">技能</span>
          </div>

          <div
            className={`sidebar-ask-zuovis sidebar-skills-entry${isAutomationActive ? ' sidebar-ask-zuovis-active' : ''}`}
            onClick={onOpenAutomation}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenAutomation() } }}
          >
            <div className="sidebar-ask-zuovis-icon sidebar-skills-icon"><Workflow size={13} /></div>
            <span className="sidebar-ask-zuovis-label">自动化</span>
          </div>

          <div
            className={`sidebar-ask-zuovis sidebar-skills-entry${isKnowledgeActive ? ' sidebar-ask-zuovis-active' : ''}`}
            onClick={onOpenKnowledge}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenKnowledge() } }}
          >
            <div className="sidebar-ask-zuovis-icon sidebar-skills-icon"><BookOpenText size={13} /></div>
            <span className="sidebar-ask-zuovis-label">知识库</span>
            {changedFileCount > 0 && (
              <span className="sidebar-primary-badge" aria-label={`${changedFileCount} 项知识库变化`}>
                {changedFileCount > 99 ? '99+' : changedFileCount}
              </span>
            )}
          </div>
        </div>

        {/* Workspaces with sessions */}
        {userWorkspacePaths.length > 0 && (
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
        {userWorkspacePaths.length === 0 ? (
          <div className="sidebar-empty-workspace">
            <button className="sidebar-new-dir-btn" onClick={onNewWorkspace}>
              新建工作区
            </button>
          </div>
        ) : (
          <Flipper
            flipKey={userWorkspacePaths.join(',')}
            spring={{ stiffness: 200, damping: 28 } as any}
            className="sidebar-workspace-list"
          >
            {userWorkspacePaths.map((wsPath, idx) => {
              const isCollapsed = collapsedWorkspaces.has(wsPath)
              const wsSessions = sessionsByWorkspace[wsPath] || []

              return (
                <Flipped key={wsPath} flipId={wsPath}>
                  <div className={`sidebar-workspace-section${isCollapsed ? ' sidebar-workspace-collapsed' : ''}`}>
                    <div
                      className="sidebar-workspace-header"
                      onClick={() => toggleWorkspace(wsPath)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWorkspace(wsPath) } }}
                      aria-label={isCollapsed ? '展开工作区' : '折叠工作区'}
                    >
                      <button className="sidebar-workspace-toggle" tabIndex={-1}>
                        {isCollapsed ? <FolderClosed size={14} /> : <FolderOpen size={14} />}
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
                          onClick={(e) => { e.stopPropagation(); handlePinToTop(wsPath) }}
                          title="置顶" aria-label="置顶"
                        >
                          <Pin size={12} />
                        </button>
                      )}
                      <button
                        className="sidebar-workspace-remove"
                        onClick={(e) => { e.stopPropagation(); onRemoveWorkspace(wsPath) }}
                        title="移除工作区" aria-label="移除工作区"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="sidebar-workspace-body">
                      <div className="sidebar-workspace-body-inner">
                        {/* Session list */}
                        {wsSessions.length === 0 && creatingSessionIn !== wsPath ? (
                          <div className="sidebar-session-empty">暂无会话</div>
                        ) : (
                          wsSessions.map((session) => {
                            // Running: prefer activeSessionRunning for the active session (reactive via prop),
                            // fall back to sessionSlots for non-active sessions (saved on switch-away)
                            const isActive = activeSessionId === session.id
                            const slot = isActive ? null : sessionSlots[session.id]
                            const attention = getSessionAttention(slot)
                            const isRenaming = renamingId === session.id
                            const isRunning = isActive
                              ? activeSessionRunning
                              : (slot?.isStreaming || (slot?.agentState && slot.agentState !== 'idle' && slot.agentState !== 'error'))
                            return (
                              <div
                                key={session.id}
                                className={`sidebar-entry sidebar-session-entry${isActive ? ' sidebar-entry-active' : ''}${attention ? ' sidebar-session-needs-attention' : ''}`}
                                onClick={() => onSessionSelect(session.id, wsPath)}
                                title={attention?.label}
                              >
                                {isRenaming ? (
                                  <input
                                    ref={renameInputRef}
                                    className="sidebar-new-file-field sidebar-session-rename-field"
                                    value={renameText}
                                    onChange={(e) => setRenameText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.isComposing) {
                                        const name = renameText.trim()
                                        if (name) void onRenameSession(session.id, name)
                                        setRenamingId(null)
                                      }
                                      if (e.key === 'Escape') setRenamingId(null)
                                    }}
                                    onBlur={() => {
                                      const name = renameText.trim()
                                      if (name) void onRenameSession(session.id, name)
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
                                {!isRenaming && !attention && !isRunning && (
                                  <span className="sidebar-session-time">
                                    {formatSessionTime(session.lastModified || session.createdAt)}
                                  </span>
                                )}
                                {attention && (
                                  <span className="sidebar-session-attention" title={attention.label} aria-label={attention.label}>
                                    {attention.type === 'permission'
                                      ? <ShieldAlert size={12} />
                                      : <MessageCircleQuestion size={12} />}
                                    {attention.count > 1 && <span className="sidebar-session-attention-count">{attention.count}</span>}
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
                                {!attention && isRunning && <Loader2 size={12} className="sidebar-session-running" />}
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
                      </div>
                  </div>
                </Flipped>
              )
            })}
          </Flipper>
        )}

      </div>

      <SidebarToolDock
        onOpenSearch={onOpenSearch}
        onOpenSettings={onOpenSettings}
        onDaydream={onDaydream}
      />
    </div>
    </>
  )
}

export default Sidebar
