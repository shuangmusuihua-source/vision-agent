import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsUp, X, Search, Settings, Plus, Pin, Eye, Ellipsis, ArrowLeft, FolderClosed, FolderOpen, Loader2, Trash2, ShieldAlert, MessageCircleQuestion, Blocks, Workflow, BookOpenText, Sun, Moon, Monitor, Cpu, Check } from 'lucide-react'
import { Flipper, Flipped } from 'react-flip-toolkit'
import { useAgentStore } from '../../store/agent-store-impl'
import { useSettings } from '../../store/settings-cache'
import appLogo from '../../assets/zuovis-logo.svg'
import { ASK_ASSISTANT_NAME } from '../../../shared/branding'
import { filterUserWorkspacePaths } from '../../../shared/workspace-paths'
import type { SdkSessionInfo } from '../../../shared/types'
import type { ContextSlot } from '../../store/agent-store'

type ThemeMode = 'light' | 'dark' | 'system'

const QUICK_THEME_OPTIONS = [
  { id: 'light' as const, label: '浅色', Icon: Sun },
  { id: 'dark' as const, label: '深色', Icon: Moon },
  { id: 'system' as const, label: '跟随系统', Icon: Monitor }
]

interface SidebarProps {
  workspacePaths: string[]
  fixedWorkspacePaths: string[]
  sessions: SdkSessionInfo[]
  activeSessionId: string | null
  activeSessionRunning: boolean
  onSessionSelect: (sessionId: string, workspacePath: string) => void
  onDeleteSession: (sessionId: string, workspacePath: string) => void
  onRenameSession: (sessionId: string, title: string) => Promise<void>
  onNewConversation: (workspacePath: string) => void
  onCancelNewSession: () => void
  creatingSessionIn: string | null
  newSessionName: string
  onNewSessionNameChange: (name: string) => void
  onCreateSession: (wsPath: string) => void
  newSessionInputRef: React.RefObject<HTMLInputElement | null>
  onNewWorkspace: () => void
  onRemoveWorkspace: (path: string) => void
  onReorderWorkspaces: (paths: string[]) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onDaydream: (mode: string) => void
  onAskZuovis: () => void
  onOpenSkills: () => void
  onOpenAutomation: () => void
  onOpenKnowledge: () => void
  onAskZuovisBack: () => void
  isAskZuovisActive: boolean
  isSkillsActive: boolean
  isAutomationActive: boolean
  isKnowledgeActive: boolean
  isAskZuovisInChat: boolean
  isAskZuovisRunning: boolean
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
  workspacePaths,
  fixedWorkspacePaths,
  sessions,
  activeSessionId,
  activeSessionRunning,
  onSessionSelect,
  onDeleteSession,
  onRenameSession,
  onNewConversation,
  onCancelNewSession,
  creatingSessionIn,
  newSessionName,
  onNewSessionNameChange,
  onCreateSession,
  newSessionInputRef,
  onNewWorkspace,
  onRemoveWorkspace,
  onReorderWorkspaces,
  onOpenSettings,
  onOpenSearch,
  onDaydream,
  onAskZuovis,
  onOpenSkills,
  onOpenAutomation,
  onOpenKnowledge,
  onAskZuovisBack,
  isAskZuovisActive,
  isSkillsActive,
  isAutomationActive,
  isKnowledgeActive,
  isAskZuovisInChat,
  isAskZuovisRunning,
  changedFileCount,
  collapsed
}: SidebarProps): React.ReactElement {
  const settings = useSettings()
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

  const [showDaydreamPicker, setShowDaydreamPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState({ left: 0, top: 0 })
  const daydreamBtnRef = useRef<HTMLButtonElement>(null)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const [quickMenuPos, setQuickMenuPos] = useState({ left: 0, bottom: 0 })
  const quickMenuBtnRef = useRef<HTMLButtonElement>(null)
  const profiles = settings?.profiles ?? []
  const activeProfileId = settings?.activeProfileId ?? null
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null
  const currentTheme = settings?.theme ?? 'system'

  const togglePicker = () => {
    if (!showDaydreamPicker && daydreamBtnRef.current) {
      setShowQuickMenu(false)
      const rect = daydreamBtnRef.current.getBoundingClientRect()
      const estimatedPickerHeight = 190
      const shouldOpenAbove = rect.bottom + estimatedPickerHeight > window.innerHeight
      setPickerPos({
        left: Math.max(12, rect.left - 4),
        top: shouldOpenAbove ? Math.max(12, rect.top - estimatedPickerHeight - 8) : rect.bottom + 8
      })
    }
    setShowDaydreamPicker(v => !v)
  }

  const toggleQuickMenu = () => {
    if (!showQuickMenu && quickMenuBtnRef.current) {
      setShowDaydreamPicker(false)
      const rect = quickMenuBtnRef.current.getBoundingClientRect()
      const menuWidth = 286
      setQuickMenuPos({
        left: Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.left - 8)),
        bottom: Math.max(12, window.innerHeight - rect.top + 10)
      })
    }
    setShowQuickMenu(v => !v)
  }

  const handleThemeChange = (theme: ThemeMode) => {
    if (theme === currentTheme) return
    void window.api.settings.setTheme(theme)
  }

  const handleProfileChange = (profileId: string) => {
    if (profileId === activeProfileId) return
    void window.api.settings.setActiveProfile(profileId)
  }

  const handleOpenSettingsFromQuickMenu = () => {
    setShowQuickMenu(false)
    onOpenSettings()
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

  useEffect(() => {
    if (!showQuickMenu) return
    const handler = (e: MouseEvent) => {
      if (quickMenuBtnRef.current && quickMenuBtnRef.current.contains(e.target as Node)) return
      const menu = document.querySelector('.sidebar-quick-menu')
      if (menu && menu.contains(e.target as Node)) return
      setShowQuickMenu(false)
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQuickMenu(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [showQuickMenu])

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

      <div className="sidebar-tool-zone" role="group" aria-label="全局工具">
        <div className="sidebar-tool-dock">
          <button
            ref={quickMenuBtnRef}
            className={`sidebar-app-btn${showQuickMenu ? ' sidebar-app-btn-active' : ''}`}
            onClick={toggleQuickMenu}
            title="工作有问题，Ask sumi"
            aria-label="工作有问题，Ask sumi"
            aria-expanded={showQuickMenu}
          >
            <img src={appLogo} alt="" />
          </button>
          <span className="sidebar-tool-separator" aria-hidden="true" />
          <button className="sidebar-icon-btn" onClick={onOpenSearch} title="搜索" aria-label="搜索">
            <Search size={16} />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置" aria-label="设置">
            <Settings size={16} />
          </button>
          <button ref={daydreamBtnRef} className="sidebar-icon-btn" onClick={togglePicker} title="心休模式" aria-label="心休模式">
            <Eye size={16} />
          </button>
        </div>
      </div>
    </div>
    {showQuickMenu && createPortal(
      <div className="sidebar-quick-menu" style={{ left: quickMenuPos.left, bottom: quickMenuPos.bottom }}>
        <div className="sidebar-quick-menu-head">
          <span className="sidebar-quick-logo" aria-hidden="true">
            <img src={appLogo} alt="" />
          </span>
          <span>
            <span className="sidebar-quick-title">工作有问题，Ask sumi</span>
            <span className="sidebar-quick-subtitle">
              {activeProfile ? `当前模型 · ${activeProfile.name}` : '尚未选择模型配置'}
            </span>
          </span>
        </div>

        <div className="sidebar-quick-section">
          <div className="sidebar-quick-section-title">外观</div>
          <div className="sidebar-quick-theme-grid" role="radiogroup" aria-label="切换主题">
            {QUICK_THEME_OPTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`sidebar-quick-theme-btn${currentTheme === id ? ' sidebar-quick-theme-btn-active' : ''}`}
                onClick={() => handleThemeChange(id)}
                role="radio"
                aria-checked={currentTheme === id}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-quick-section">
          <div className="sidebar-quick-section-row">
            <div className="sidebar-quick-section-title">模型</div>
            <button className="sidebar-quick-link" onClick={handleOpenSettingsFromQuickMenu}>管理</button>
          </div>
          <div className="sidebar-quick-model-list">
            {profiles.length > 0 ? profiles.map((profile) => {
              const isActive = profile.id === activeProfileId
              return (
                <button
                  key={profile.id}
                  className={`sidebar-quick-model-row${isActive ? ' sidebar-quick-model-row-active' : ''}`}
                  onClick={() => handleProfileChange(profile.id)}
                >
                  <span className="sidebar-quick-model-icon" aria-hidden="true"><Cpu size={14} /></span>
                  <span className="sidebar-quick-model-copy">
                    <span className="sidebar-quick-model-name">{profile.name || '未命名配置'}</span>
                    <span className="sidebar-quick-model-meta">{profile.model || profile.apiProvider || '未设置模型'}</span>
                  </span>
                  {isActive && <Check size={15} className="sidebar-quick-check" aria-hidden="true" />}
                </button>
              )
            }) : (
              <button className="sidebar-quick-empty" onClick={handleOpenSettingsFromQuickMenu}>
                添加模型配置
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
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
