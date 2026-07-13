import { useCallback, useEffect, useRef, lazy, Suspense, useState } from 'react'
import { useUiStore, type PrimaryView } from '../../store/ui-slice'
import { FileText, Download, ArrowLeftRight, ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { useModal } from '../common/ModalSystem'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import SearchPanel from '../search/SearchPanel'
import AskZuovis from '../ask/AskZuovis'
import { ErrorBoundary } from '../common/ErrorBoundary'
import DaydreamOverlay from './DaydreamOverlay'
import OverviewPanel from './OverviewPanel'
import './OverviewPanel.css'
import { useAgent, useIPCSubscriptions, useIsStreaming, useMessages, usePermissionRequest, usePermissionQueueLength, useAskUserRequest, useCurrentSessionId, useSessionList, useAgentStatus, useActiveSkillId } from '../../hooks/useAgent'
import { useAppShortcuts } from '../../hooks/useAppShortcuts'
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useTabs, type SaveFileResult } from '../../hooks/useTabs'
import { useAgentStore } from '../../store/agent-store-impl'
import type { AgentContext, SessionOutputEntry, TabDescriptor } from '../../../shared/types'
import { isFileTab, OVERVIEW_TAB_ID } from '../../../shared/types'
import { filterUserWorkspacePaths, findContainingWorkspacePath } from '../../../shared/workspace-paths'
import { useChangedFileCount, useGraphStore } from '../../store/graph-store'
import { useSettings } from '../../store/settings-cache'
import type { SkillDefinition } from '../../lib/ipc'
import { buildSkillInvocationPrompt } from '../../../shared/skill-invocation'
import { checkForAppUpdates, getUpdateProgressLabel, performPrimaryUpdateAction } from '../../lib/app-update'
import type { MarkdownEditorHandle } from '../editor/MarkdownEditor'
import type { AppNotification } from '../../notifications/notification-inbox'
import NotificationCenter from '../notifications/NotificationCenter'
import WorkspaceDialogs from '../workspace/WorkspaceDialogs'

const MarkdownEditor = lazy(() => import('../editor/MarkdownEditor'))
const ChatView = lazy(() => import('../chat/ChatView'))
const SkillLibrary = lazy(() => import('../skills/SkillLibrary'))
const AutomationPanel = lazy(() => import('../automation/AutomationPanel'))
const KnowledgePanel = lazy(() => import('../knowledge/KnowledgePanel'))

interface AppShellProps {
  onOpenSettings: () => void
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }): React.ReactElement {
  return (
    <svg
      className={`sidebar-toggle-icon${collapsed ? ' sidebar-toggle-icon-collapsed' : ''}`}
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <rect className="sidebar-toggle-icon-frame" x="2.5" y="3" width="13" height="12" rx="2.5" />
      <path className="sidebar-toggle-icon-rail" d="M6.3 4.8v8.4" />
    </svg>
  )
}

function AppShell({ onOpenSettings }: AppShellProps): React.ReactElement {
  const modal = useModal()
  const setAgentContext = useAgentStore((state) => state.setContext)
  const setAgentLinkedFile = useAgentStore((state) => state.setLinkedFile)
  const setSessionOutputsLoading = useAgentStore((state) => state.setSessionOutputsLoading)
  const removeSessionState = useAgentStore((state) => state.removeSessionState)
  const clearContextSession = useAgentStore((state) => state.clearContextSession)
  const setAgentPrefill = useAgentStore((state) => state.setPrefill)

  // ── Hooks: workspace, tabs ──────────────────────────────────────────

  const workspace = useWorkspace()
  const {
    openTabs, activeTab, activeContent, activeFilePath,
    openFile, openFixedTab, closeTab, switchTab, clearTab, closeTabsByPrefix,
    saveFile, retryPendingSave, refreshActiveContent,
    activeSaveError, activeHasPendingSave,
  } = useTabs()
  const [isRetryingSave, setIsRetryingSave] = useState(false)
  const [automationFocusTaskId, setAutomationFocusTaskId] = useState<string | null>(null)
  const activeFilePathRef = useRef(activeFilePath)
  activeFilePathRef.current = activeFilePath

  // Stable refs for workspace values used in useCallback/useEffect deps
  // (the workspace object changes every render — avoid putting it in dep arrays)
  const workspacePathsRef = useRef(workspace.workspacePaths)
  workspacePathsRef.current = workspace.workspacePaths

  // ── Layout hooks ────────────────────────────────────────────────────

  const {
    sidebarCollapsed, setSidebarCollapsed,
    agentWidth, agentCollapsed,
    isChatFirst, setIsChatFirst,
    shellRef,
    dividerHovered, setDividerHovered, isDragging,
    handleSwapLayout, handleExpand, handleToggleAgent, handleDividerMouseDown,
    toggleVisible, handleToggleMouseEnter, handleToggleMouseLeave,
  } = useResponsiveLayout()

  // ── Editor / UI state ───────────────────────────────────────────────

  const {
    showSearch, searchQuery, openSearch, closeSearch: closeSearchPanel,
    sourceMode, setSourceMode, focusMode, setFocusMode,
    editorStats, setEditorStats, linkedFile, setLinkedFile,
    view, setView, updateState, setUpdateState,
    showDaydream, daydreamMode, openDaydream, closeDaydream,
    mainError, setMainError,
  } = useUiStore()
  const sourceModeRef = useRef(sourceMode)
  sourceModeRef.current = sourceMode
  const focusModeRef = useRef(focusMode)
  focusModeRef.current = focusMode
  const changedFileCount = useChangedFileCount()
  const updateError = updateState.status === 'error' ? updateState.message || '未知错误' : null

  const editorRef = useRef<MarkdownEditorHandle | null>(null)

  const handleSaveFile = useCallback(async (filePath: string, content: string): Promise<SaveFileResult> => {
    return saveFile(filePath, content)
  }, [saveFile])

  useEffect(() => {
    setIsRetryingSave(false)
  }, [activeFilePath])

  const handleRetrySave = useCallback(async () => {
    if (isRetryingSave) return
    setIsRetryingSave(true)
    try {
      await retryPendingSave(activeFilePathRef.current)
    } finally {
      setIsRetryingSave(false)
    }
  }, [isRetryingSave, retryPendingSave])

  const setEditorLinkedFile = useCallback((path: string | null) => {
    setLinkedFile(path)
    setAgentLinkedFile('editor', path)
  }, [setAgentLinkedFile, setLinkedFile])

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  useAppShortcuts({ setShowSearch: () => openSearch(), setIsChatFirst })

  // ── Auto-link active tab → linked file ──────────────────────────────

  useEffect(() => {
    if (activeTab && isFileTab(activeTab)) setEditorLinkedFile(activeTab.path)
  }, [activeTab, setEditorLinkedFile])

  const handleUpdateAction = useCallback(async () => {
    await performPrimaryUpdateAction()
  }, [])

  const handleRetryUpdateCheck = useCallback(async () => {
    await checkForAppUpdates()
  }, [])

  const activeWorkspacePath = useAgentStore((s) => s.activeWorkspacePath)
  const editorWorkspacePath = useAgentStore((s) => s.slots.editor.workspacePath || s.activeWorkspacePath)
  const activeSessionId = useAgentStore((s) => s.activeSessionId.editor)
  const sessionLoadError = useAgentStore((s) => s.sessionLoadError)
  const retrySessionLoad = useAgentStore((s) => s.retrySessionLoad)
  const clearSessionLoadError = useAgentStore((s) => s.clearSessionLoadError)
  const activeFileWorkspacePath = findContainingWorkspacePath(
    activeFilePath,
    [...workspace.workspacePaths, ...workspace.fixedWorkspacePaths],
  )
  const sessionOutputRequestVersions = useRef(new Map<string, number>())
  const sessionOutputRefreshTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const refreshSessionOutputs = useCallback((sessionId: string, showLoading = false) => {
    const requestVersion = (sessionOutputRequestVersions.current.get(sessionId) || 0) + 1
    sessionOutputRequestVersions.current.set(sessionId, requestVersion)
    if (showLoading) setSessionOutputsLoading(true)

    return window.api.agent.getSessionOutputs(sessionId).then((outputs) => {
      const isLatestRequest = sessionOutputRequestVersions.current.get(sessionId) === requestVersion
      const isActiveSession = useAgentStore.getState().activeSessionId.editor === sessionId
      if (isLatestRequest && isActiveSession) {
        useAgentStore.getState().setSessionOutputs(outputs)
      }
    }).catch(() => {
      const isLatestRequest = sessionOutputRequestVersions.current.get(sessionId) === requestVersion
      const isActiveSession = useAgentStore.getState().activeSessionId.editor === sessionId
      if (isLatestRequest && isActiveSession) {
        useAgentStore.getState().setSessionOutputs(null)
      }
    })
  }, [setSessionOutputsLoading])

  const scheduleSessionOutputsRefresh = useCallback((sessionId: string) => {
    const existing = sessionOutputRefreshTimers.current.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      sessionOutputRefreshTimers.current.delete(sessionId)
      void refreshSessionOutputs(sessionId)
    }, 120)
    sessionOutputRefreshTimers.current.set(sessionId, timer)
  }, [refreshSessionOutputs])

  useEffect(() => () => {
    for (const timer of sessionOutputRefreshTimers.current.values()) clearTimeout(timer)
    sessionOutputRefreshTimers.current.clear()
  }, [])

  // Load sessions when workspace changes
  const skipNextSessionLoad = useRef(false)
  useEffect(() => {
    if (skipNextSessionLoad.current) {
      skipNextSessionLoad.current = false
      return
    }
    loadSessions()
  }, [activeWorkspacePath])

  // Auto-open overview tab when active session changes (per-session tabs)
  useEffect(() => {
    if (activeWorkspacePath && activeSessionId && view === 'editor') {
      openFixedTab(OVERVIEW_TAB_ID)
    }
  }, [activeSessionId])

  // Load session outputs when active session changes
  useEffect(() => {
    if (activeSessionId) {
      void refreshSessionOutputs(activeSessionId, true)
    } else {
      useAgentStore.getState().setSessionOutputs(null)
    }
  }, [activeSessionId, refreshSessionOutputs])

  useEffect(() => {
    return window.api.agent.onSessionFilesChanged(({ sessionId }) => {
      if (useAgentStore.getState().activeSessionId.editor !== sessionId) return
      scheduleSessionOutputsRefresh(sessionId)
    })
  }, [scheduleSessionOutputsRefresh])

  // ── Session selection / new conversation handlers ─────────────────────

  const handleSessionSelect = useCallback((sessionId: string, workspacePath: string) => {
    // Switch to session-isolated slot (also sets activeSessionId, loading flag,
    // and kicks off SDK message load when the slot has _needsSdkLoad === true).
    useAgentStore.getState().switchToSession(sessionId, 'editor', workspacePath || null)
    setLinkedFile(useAgentStore.getState().slots.editor.linkedFile || null)
    if (workspacePath && workspacePath !== activeWorkspacePath) {
      useAgentStore.getState().setActiveWorkspace(workspacePath)
    }
    // session outputs loaded by useEffect on activeSessionId change
    if (view !== 'editor') {
      setAgentContext('editor')
      setView('editor')
    }
    const overviewTab = openTabs.find(t => t.type === 'fixed')
    if (overviewTab) switchTab(overviewTab)
  }, [activeWorkspacePath, view, openTabs, switchTab, setAgentContext, setLinkedFile])

  const handleNotificationOpen = useCallback((notification: AppNotification) => {
    const target = notification.target
    if (target?.view === 'automation') {
      setAutomationFocusTaskId(target.taskId || null)
      clearTab()
      setView('automation')
      return
    }
    if (target?.view === 'skills') {
      clearTab()
      setView('skills')
      return
    }
    if (target?.view === 'knowledge') {
      clearTab()
      setView('knowledge')
      return
    }
    if (target?.view === 'ask') {
      setAgentContext('ask')
      clearTab()
      setView('ask')
      return
    }
    if (target?.view === 'editor') {
      setAgentContext('editor')
      setView('editor')
      if (target.sessionId && target.workspacePath) {
        handleSessionSelect(target.sessionId, target.workspacePath)
      }
      return
    }

    if ('context' in notification && notification.context === 'ask') {
      setAgentContext('ask')
      clearTab()
      setView('ask')
      return
    }
    if ('context' in notification && notification.context === 'editor') {
      setAgentContext('editor')
      setView('editor')
      if (notification.sessionId && notification.workspacePath) {
        handleSessionSelect(notification.sessionId, notification.workspacePath)
      }
    }
  }, [clearTab, handleSessionSelect, setAgentContext, setView])

  const { creatingSessionIn, setCreatingSessionIn, newSessionName, setNewSessionName } = useUiStore()
  const newSessionInputRef = useRef<HTMLInputElement>(null)
  const creatingSessionRequestRef = useRef(false)

  useEffect(() => {
    if (creatingSessionIn) {
      setNewSessionName('')
      setTimeout(() => newSessionInputRef.current?.focus(), 50)
    }
  }, [creatingSessionIn])

  const handleCreateSession = useCallback(async (wsPath: string) => {
    const name = newSessionName.trim()
    if (!name || creatingSessionRequestRef.current) return
    creatingSessionRequestRef.current = true
    const tempSessionId = `new-${Date.now()}`
    const now = Date.now()
    try {
      const result = await window.api.agent.updateSessionRecord(tempSessionId, {
        title: name,
        workspacePath: wsPath,
        context: 'editor',
        status: 'empty',
        createdAt: now,
        lastModified: now,
        messageCount: 0,
      })
      if (!result.success) throw new Error('会话记录未保存')
    } catch (error) {
      console.error('[AppShell] create session persistence failed:', error)
      await modal.alert({ title: '创建失败', message: '无法保存新会话，请稍后重试' })
      return
    } finally {
      creatingSessionRequestRef.current = false
    }

    if (wsPath !== activeWorkspacePath) {
      skipNextSessionLoad.current = true
    }
    // Only expose the session after its app-owned record is durable.
    useAgentStore.getState().switchToSession(tempSessionId, 'editor', wsPath)
    setEditorLinkedFile(null)
    if (wsPath !== activeWorkspacePath) {
      useAgentStore.getState().setActiveWorkspace(wsPath)
    }
    // Add to sessionList via the protocol — single write path
    useAgentStore.getState().dispatchSessionList({
      type: 'CREATE_TEMP',
      sessionId: tempSessionId,
      title: name,
      workspacePath: wsPath,
    })
    setCreatingSessionIn(null)
    if (view !== 'editor') {
      setAgentContext('editor')
      setView('editor')
    }
  }, [newSessionName, activeWorkspacePath, view, setAgentContext, setEditorLinkedFile, modal])

  useEffect(() => {
    return window.api.onMainError((error) => {
      console.error(`[Main ${error.type}]`, error.message)
      setMainError(error.message)
    })
  }, [])

  const activeTabRef = useRef<TabDescriptor | null>(activeTab)
  activeTabRef.current = activeTab
  const refreshActiveContentRef = useRef(refreshActiveContent)
  refreshActiveContentRef.current = refreshActiveContent

  useEffect(() => {
    return window.api.graph.onFilesChanged((data) => {
      useGraphStore.getState().handleFilesChanged(data)
      const current = activeTabRef.current
      if (current && isFileTab(current) && data.files.includes(current.path)) {
        refreshActiveContentRef.current()
      }
    })
  }, [])

  useEffect(() => {
    return window.api.menu.onAction((action) => {
      switch (action) {
        case 'open-settings': onOpenSettings(); break
        case 'toggle-sidebar': setSidebarCollapsed((v) => !v); break
        case 'toggle-agent-panel': handleToggleAgent(); break
        case 'open-search': openSearch(); break
        case 'toggle-source-mode': setSourceMode(!sourceModeRef.current); break
        case 'toggle-focus-mode': setFocusMode(!focusModeRef.current); break
        case 'save-file': break
      }
    })
  }, [onOpenSettings, handleToggleAgent])

  // ── Singleton IPC → agent store ─────────────────────────────────────

  useIPCSubscriptions()

  // ── Agent hooks (editor context) ────────────────────────────────────

  const {
    sendMessage: editorSendMessage,
    loadSessions,
    respondPermission,
    respondAskUser: editorRespondAskUser,
  } = useAgent('editor')

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const ok = await modal.confirm({
      title: '删除会话',
      message: '确定删除此会话？会话中的对话记录和会话文件将被永久删除，此操作不可撤销。',
      variant: 'danger',
    })
    if (!ok) return
    const wasActive = useAgentStore.getState().activeSessionId.editor === sessionId

    const slot = useAgentStore.getState().sessionSlots[sessionId]
    const sdkSessionId = slot?.sdkSessionId
      || useAgentStore.getState().sessionList.find(s => s.id === sessionId)?.sdkSessionId
      || (sessionId.startsWith('new-') ? null : sessionId)

    try {
      if (sdkSessionId) {
        await window.api.agent.deleteSession(sdkSessionId)
      } else {
        await window.api.agent.removeSessionRecord(sessionId)
      }
    } catch (err) {
      console.error('[AppShell] deleteSession error:', err)
      await modal.alert({ title: '删除失败', message: '无法删除会话，请稍后重试' })
      return
    }
    removeSessionState(sessionId)
    if (wasActive) {
      useAgentStore.getState().switchToSession('')
      useAgentStore.getState().setSessionOutputs(null)
      setEditorLinkedFile(null)
      if (view !== 'editor') {
        setView('editor')
      }
    }
  }, [modal, view, loadSessions, removeSessionState, setEditorLinkedFile])

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      const result = await window.api.agent.renameSession(sessionId, title)
      if (!result.success) throw new Error('会话名称未保存')
      useAgentStore.getState().dispatchSessionList({ type: 'RENAME', sessionId, title })
    } catch (error) {
      console.error('[AppShell] rename session failed:', error)
      await modal.alert({ title: '重命名失败', message: '无法保存会话名称，请稍后重试' })
    }
  }, [modal])

  const isStreaming = useIsStreaming('editor')
  const prevIsStreamingRef = useRef(isStreaming)
  const editorPermission = usePermissionRequest('editor')
  const editorPermissionQueueLen = usePermissionQueueLength('editor')
  const editorAskUser = useAskUserRequest('editor')
  const editorAskUserRespondRef = useRef<((answers: Record<string, string>) => void) | null>(null)
  const currentSessionId = useCurrentSessionId('editor')
  const sessionList = useSessionList()
  const editorSessionList = sessionList.filter((s) => s.context !== 'ask')
  const agentStatus = useAgentStatus('editor')
  const activeSkillId = useActiveSkillId('editor')
  // ── Agent hooks (ask context) ───────────────────────────────────────

  const askIsStreaming = useIsStreaming('ask')
  const askMessages = useMessages('ask')

  // ── Settings → workspace sync ───────────────────────────────────────

  const settings = useSettings()
  useEffect(() => {
    if (!settings) return
    const userDirectories = filterUserWorkspacePaths(settings.authorizedDirectories, settings.fixedDirectories)
    workspace.syncFromSettings(settings.authorizedDirectories, settings.fixedDirectories)
    // Set initial active workspace if not yet set
    const currentActiveWorkspace = useAgentStore.getState().activeWorkspacePath
    if ((!currentActiveWorkspace || !userDirectories.includes(currentActiveWorkspace)) && userDirectories.length > 0) {
      useAgentStore.getState().setActiveWorkspace(userDirectories[0])
    } else if (currentActiveWorkspace && userDirectories.length === 0) {
      useAgentStore.getState().setActiveWorkspace(null)
    }
  }, [settings])

  // ── View routing helpers ────────────────────────────────────────────

  const handleAskZuovisBack = useCallback(() => {
    const askSid = useAgentStore.getState().slots.ask.currentSessionId
    if (askIsStreaming) {
      useAgentStore.getState().dispatchAgentEvent({ type: 'ABORT' }, 'ask', askSid)
      window.api.agent.abort(askSid || 'ask')
    }
    clearContextSession('ask')
  }, [askIsStreaming, clearContextSession])

  // ── File selection (bridges workspace + tabs) ───────────────────────

  const handleFileSelect = useCallback(async (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase()
    // PDF and HTML slides — open with system default app, not in-editor
    if (ext === 'pdf' || ext === 'html' || ext === 'htm') {
      window.api.workspace.openInBrowser(path)
      return
    }
    if (view !== 'editor') {
      setAgentContext('editor')
      setView('editor')
    }
    const wsPath = findContainingWorkspacePath(path, [
      ...workspace.fixedWorkspacePaths,
      ...workspace.workspacePaths,
    ])
    if (wsPath) {
      useAgentStore.getState().setActiveWorkspace(wsPath)
    }
    await openFile(path)
  }, [openFile, setAgentContext, view, workspace.fixedWorkspacePaths, workspace.workspacePaths])

  const handleAddToKnowledge = useCallback(async (filePath: string) => {
    const result = await window.api.workspace.addToKnowledge(filePath, activeSessionId || undefined)
    if (!result.success) {
      await modal.alert({ title: '无法放入知识库', message: result.error || '请稍后重试' })
    } else if (activeSessionId) {
      await refreshSessionOutputs(activeSessionId)
    }
    return result
  }, [activeSessionId, modal, refreshSessionOutputs])

  const handleRevealSessionOutput = useCallback(async (filePath: string) => {
    if (!activeSessionId) return
    const result = await window.api.agent.revealSessionOutput(activeSessionId, filePath)
    if (!result.success) {
      await modal.alert({ title: '无法打开所在目录', message: result.error || '产物可能已被移动或删除' })
    }
  }, [activeSessionId, modal])

  const handleDeleteSessionOutput = useCallback(async (file: SessionOutputEntry) => {
    if (!activeSessionId) return false
    const confirmed = await modal.confirm({
      title: '删除产物',
      message: `确定删除“${file.fileName}”吗？文件会被移到废纸篓。`,
      variant: 'danger',
      confirmLabel: '删除',
    })
    if (!confirmed) return false
    const result = await window.api.agent.deleteSessionOutput(activeSessionId, file.filePath)
    if (!result.success) {
      await modal.alert({ title: '删除失败', message: result.error || '请稍后重试' })
      return false
    }
    await refreshSessionOutputs(activeSessionId)
    return true
  }, [activeSessionId, modal, refreshSessionOutputs])

  // ── File operations (bridging workspace + tabs) ─────────────────────

  // ── Auto-refresh after agent finishes ───────────────────────────────

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    prevIsStreamingRef.current = isStreaming
    // Only trigger on streaming → idle transition (agent just finished)
    if (!wasStreaming || isStreaming) return
    const hasMessages = useAgentStore.getState().slots.editor.messages.length > 0
    if (!hasMessages) return

    // Refresh session outputs so OverviewPanel shows newly produced files
    const sid = useAgentStore.getState().activeSessionId.editor
    if (sid) {
      scheduleSessionOutputsRefresh(sid)
    }

    const tab = activeTabRef.current
    if (tab && isFileTab(tab)) {
      const timer = setTimeout(() => { refreshActiveContentRef.current().catch(() => {}) }, 500)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, scheduleSessionOutputsRefresh])

  // ── Text selection, ask-agent, stats, skill ─────────────────────────

  const handleSelectText = useCallback((text: string, sourceContext?: string) => {
    const target: AgentContext = sourceContext === 'ask' ? 'ask' : 'editor'
    setAgentPrefill(target, text)
  }, [setAgentPrefill])

  const handleAskAgent = useCallback(
    (action: 'explain' | 'edit' | 'review' | 'ask', selection: string, filePath: string) => {
      const context = `文件：${filePath}\n\n选中内容：\n${selection}`
      const prompts: Record<string, string> = {
        explain: `${context}\n\n请解释以上选中内容。`,
        edit: `${context}\n\n请修改以上选中内容。`,
        review: `${context}\n\n请检查以上选中内容是否有问题。`,
        ask: `${context}\n\n`
      }
      if (action === 'ask') {
        const target: AgentContext = view === 'ask' ? 'ask' : 'editor'
        setAgentPrefill(target, prompts.ask)
      } else {
        editorSendMessage(prompts[action], filePath)
      }
    },
    [editorSendMessage, setAgentPrefill, view]
  )

  const handleStatsUpdate = useCallback((words: number, chars: number) => {
    setEditorStats({ words, chars })
  }, [])

  const handleSkillSelect = useCallback((skill: SkillDefinition) => {
    const selectedFile = linkedFile || activeFilePath || null
    const fileRef = selectedFile
      ? `\n\n输入文档：${selectedFile}\n开始执行 Skill 前，必须先使用 Read 工具读取该 Markdown 文件的完整内容，并以文档内容作为主要输入。`
      : ''
    const prompt = buildSkillInvocationPrompt(skill.id, skill.promptTemplate, fileRef)
    editorSendMessage(prompt, selectedFile || undefined, {
      skill: { id: skill.id, name: skill.name, icon: skill.icon },
    })
  }, [activeFilePath, editorSendMessage, linkedFile])

  const handleWorkspaceDeleted = useCallback((deletedPath: string) => {
    closeTabsByPrefix(`${deletedPath}/`)
    const remaining = workspace.workspacePaths.filter((path) => path !== deletedPath)
    useAgentStore.getState().setActiveWorkspace(remaining[0] || null)
  }, [closeTabsByPrefix, workspace.workspacePaths])

  const handleSidebarNavigate = useCallback((nextView: Exclude<PrimaryView, 'editor'>) => {
    if (nextView === 'ask') {
      setAgentContext('ask')
      clearTab()
    }
    setView(nextView)
  }, [clearTab, setAgentContext, setView])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="app-shell" ref={shellRef}>
      <nav aria-label="侧边栏" style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        navigation={{
          view,
          open: handleSidebarNavigate,
          ask: {
            hasConversation: askMessages.length > 0,
            running: askIsStreaming,
            back: handleAskZuovisBack,
          },
          changedFileCount,
        }}
        workspaces={{
          paths: workspace.workspacePaths,
          fixedPaths: workspace.fixedWorkspacePaths,
          create: workspace.handleOpenNewWorkspaceModal,
          remove: workspace.handleRemoveWorkspace,
          reorder: workspace.handleReorderWorkspaces,
        }}
        sessions={{
          items: editorSessionList,
          activeId: view === 'editor' ? activeSessionId : null,
          activeRunning: isStreaming,
          select: handleSessionSelect,
          remove: handleDeleteSession,
          rename: handleRenameSession,
          draft: {
            workspacePath: creatingSessionIn,
            title: newSessionName,
            inputRef: newSessionInputRef,
            begin: setCreatingSessionIn,
            cancel: () => setCreatingSessionIn(null),
            change: setNewSessionName,
            submit: handleCreateSession,
          },
        }}
        tools={{
          openSettings: onOpenSettings,
          openSearch: openSearch,
          openDaydream,
        }}
      />
      </nav>
      <main className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${isChatFirst ? ' main-content-secondary' : ''}${view === 'ask' ? ' main-content-ask-zuovis' : ''}${view === 'skills' || view === 'automation' || view === 'knowledge' ? ' main-content-module' : ''}`}
           style={{ order: isChatFirst ? 2 : 0 }}
           aria-label={view === 'knowledge' ? '知识库' : view === 'automation' ? '自动化' : view === 'skills' ? '技能' : view === 'ask' ? 'Ask sumi' : '编辑器'}>
        {view === 'ask' ? (
          <AskZuovis
            onOpenFile={handleFileSelect}
            onSelectText={handleSelectText}
          />
        ) : view === 'skills' ? (
          <ErrorBoundary onReset={() => {}}>
            <Suspense fallback={<div className="skill-library-loading">正在加载技能...</div>}>
              <SkillLibrary />
            </Suspense>
          </ErrorBoundary>
        ) : view === 'automation' ? (
          <ErrorBoundary onReset={() => {}}>
            <Suspense fallback={<div className="skill-library-loading">正在加载自动化...</div>}>
              <AutomationPanel
                workspacePaths={workspace.workspacePaths}
                sessions={editorSessionList}
                activeSessionId={activeSessionId}
                activeWorkspacePath={activeWorkspacePath}
                focusTaskId={automationFocusTaskId}
                onFocusTaskConsumed={() => setAutomationFocusTaskId(null)}
              />
            </Suspense>
          </ErrorBoundary>
        ) : view === 'knowledge' ? (
          <ErrorBoundary onReset={() => {}}>
            <Suspense fallback={<div className="skill-library-loading">正在加载知识库...</div>}>
              <KnowledgePanel
                knowledgePath={workspace.fixedWorkspacePaths[0] || null}
                activeFile={activeFilePath}
                onOpenFile={handleFileSelect}
                onSearchEntity={openSearch}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
        <>
        <div className={`main-content-header${sidebarCollapsed ? ' main-content-header-cover-sidebar' : ''}`}>
          {openTabs.length > 0 && (
            <EditorTabs
              tabs={openTabs}
              activeTab={activeTab}
              onTabSwitch={switchTab}
              onTabClose={closeTab}
            />
          )}
        </div>
        <div className="main-content-scroll">
        {activeTab && isFileTab(activeTab) ? (
          <ErrorBoundary onReset={() => {}}>
          <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
            <MarkdownEditor
              ref={editorRef}
              content={activeContent}
              filePath={activeFilePath}
              workspacePath={activeFileWorkspacePath || editorWorkspacePath || ''}
              sourceMode={sourceMode}
              focusMode={focusMode}
              onOpenFile={handleFileSelect}
              onSave={handleSaveFile}
              onAskAgent={handleAskAgent}
              onStatsUpdate={handleStatsUpdate}
            />
          </Suspense>
          </ErrorBoundary>
        ) : activeWorkspacePath ? (
          <ErrorBoundary onReset={() => {}}>
          <OverviewPanel
            sessionId={activeSessionId}
            activeFilePath={linkedFile || activeFilePath}
            onOpenFile={handleFileSelect}
            onAddToKnowledge={handleAddToKnowledge}
            onRevealOutput={handleRevealSessionOutput}
            onDeleteOutput={handleDeleteSessionOutput}
          />
          </ErrorBoundary>
        ) : (
          <div className="editor-empty">
            <FileText size={48} className="editor-empty-icon" />
            <span className="editor-empty-hint">选择文件或打开工作区</span>
          </div>
        )}
        </div>
        {activeTab && isFileTab(activeTab) && (
          <div className="editor-status-bar" role="status">
            <span>{editorStats.words} words</span>
            <span>{editorStats.chars} characters</span>
            {sourceMode && <span>Source</span>}
            {focusMode && <span>Focus</span>}
            {activeHasPendingSave && (
              <span className="editor-save-status editor-save-status-error" title={activeSaveError || '保存失败'}>
                <span>未保存：{activeSaveError || '保存失败'}</span>
                <button
                  className="editor-save-retry-btn"
                  onClick={handleRetrySave}
                  disabled={isRetryingSave}
                  title="重试保存"
                >
                  {isRetryingSave ? '保存中' : '重试'}
                </button>
              </span>
            )}
          </div>
        )}
        </>
        )}
      </main>
      {/* ── Divider Zone + Agent Panel (only in editor mode) ── */}
      {view === 'editor' && (
      <>
      <div
        className={`divider-zone${dividerHovered ? ' divider-zone-hover' : ''}${isDragging ? ' divider-zone-dragging' : ''}${agentCollapsed ? ' divider-zone-collapsed' : ''}`}
        style={{ order: agentCollapsed ? (isChatFirst ? 0 : 2) : 1 }}
        onMouseEnter={() => setDividerHovered(true)}
        onMouseLeave={() => { if (!isDragging) setDividerHovered(false) }}
        onMouseDown={handleDividerMouseDown}
      >
        <div className="divider-line" />
        {!agentCollapsed && (
          <button className="divider-swap-btn" onClick={handleSwapLayout} title="切换面板位置" aria-label="切换面板位置">
            <ArrowLeftRight size={14} />
          </button>
        )}
        {agentCollapsed && (
          <button className="divider-expand-btn" onClick={handleExpand} title="展开面板" aria-label="展开面板">
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      <aside
        className={`agent-panel-shell${isChatFirst && sidebarCollapsed ? ' agent-panel-shell-cover-sidebar' : ''}`}
        style={{ display: agentCollapsed ? 'none' : 'flex', height: '100%', order: isChatFirst ? 0 : 2 }}
      >
      <AgentPanel
        width={agentWidth}
        edgeClass={isChatFirst ? 'agent-panel-edge-left' : 'agent-panel-edge-right'}
        workspacePath={editorWorkspacePath || undefined}
        permissionRequest={editorPermission}
        permissionQueueLength={editorPermissionQueueLen}
        onPermissionRespond={respondPermission}
        askUserRequest={editorAskUser}
        onAskUserRespond={editorRespondAskUser}
        onAskUserDrawerRespond={(respond) => { editorAskUserRespondRef.current = respond }}
        sessionList={editorSessionList}
        currentSessionId={currentSessionId}
        activeSkillId={activeSkillId}
        chatInput={<ChatInput context="editor" onSend={(msg) => {
          if (editorAskUser && editorAskUserRespondRef.current) {
            const qKey = editorAskUser.questions[0]?.question || 'answer'
            editorAskUserRespondRef.current({ [qKey]: msg })
          } else {
            editorSendMessage(msg, linkedFile || undefined)
          }
        }} onSkillSelect={handleSkillSelect} onStop={() => {
            const sid = useAgentStore.getState().slots.editor.currentSessionId
            useAgentStore.getState().dispatchAgentEvent({ type: 'ABORT' }, 'editor', sid)
            window.api.agent.abort(sid || 'editor')
          }} disabled={(isStreaming && agentStatus !== 'waitingForUserInput') && !editorAskUser} isStreaming={isStreaming} placeholder={agentStatus === 'waitingForUserInput' ? '回答 Agent 的问题...' : undefined} />}
        linkedFile={linkedFile}
        onUnlinkFile={() => setEditorLinkedFile(null)}
      >
        <ErrorBoundary>
        <Suspense fallback={<div className="chat-loading">加载对话...</div>}>
          <ChatView context="editor" onOpenFile={handleFileSelect} onSelectText={handleSelectText} workspacePath={editorWorkspacePath || undefined} />
        </Suspense>
        </ErrorBoundary>
      </AgentPanel>
      </aside>
      </>
      )}
      {/* ── Banners ── */}
      <NotificationCenter onNavigate={handleNotificationOpen} />
      {updateError && (
        <div className="update-banner update-banner-error">
          <span>更新失败: {updateError.slice(0, 60)}{updateError.length > 60 ? '...' : ''}</span>
          <button
            className="update-banner-btn"
            onClick={() => {
              void (updateState.recovery === 'manual-download'
                ? performPrimaryUpdateAction()
                : handleRetryUpdateCheck())
            }}
          >
            {updateState.recovery === 'manual-download'
              ? <><ExternalLink size={14} /> 打开下载页</>
              : <><Download size={14} /> 重试</>}
          </button>
          <button className="update-banner-dismiss" onClick={() => setUpdateState({ status: 'idle' })}>✕</button>
        </div>
      )}
      {sessionLoadError && (
        <div className="update-banner update-banner-error">
          <span>会话加载失败: {sessionLoadError.message.slice(0, 60)}{sessionLoadError.message.length > 60 ? '...' : ''}</span>
          <button className="update-banner-btn" onClick={() => { void retrySessionLoad() }}>
            <RefreshCw size={14} /> 重试
          </button>
          <button className="update-banner-dismiss" onClick={clearSessionLoadError}>✕</button>
        </div>
      )}
      {mainError && (
        <div className="update-banner update-banner-error" role="alert" title={mainError}>
          <span>应用错误: {mainError.slice(0, 80)}{mainError.length > 80 ? '...' : ''}</span>
          <button
            className="update-banner-dismiss"
            aria-label="关闭应用错误提示"
            onClick={() => setMainError(null)}
          >
            ✕
          </button>
        </div>
      )}
      {showSearch && (
        <SearchPanel
          onOpenFile={handleFileSelect}
          onClose={() => closeSearchPanel()}
          initialQuery={searchQuery}
        />
      )}
      {!updateError && ['available', 'downloading', 'downloaded', 'installing'].includes(updateState.status) && (
        <div className="update-action-area">
          <button
            className={`update-action-btn${updateState.status === 'downloaded' ? ' update-action-btn-ready' : ''}${updateState.status === 'installing' ? ' update-action-btn-working' : ''}${updateState.status === 'downloading' ? ' update-action-btn-progress' : ''}`}
            onClick={() => { void handleUpdateAction() }}
            disabled={['downloading', 'installing'].includes(updateState.status)}
            title={updateState.status === 'downloaded'
              ? '安装更新并重启'
              : updateState.status === 'downloading'
                ? getUpdateProgressLabel(updateState)
                : updateState.status === 'installing'
                  ? '正在安装更新'
                  : `下载更新 v${updateState.version || ''}`}
            aria-label={updateState.status === 'downloaded'
              ? '安装更新并重启'
              : updateState.status === 'downloading'
                ? getUpdateProgressLabel(updateState)
                : updateState.status === 'installing'
                  ? '正在安装更新'
                  : `下载更新 v${updateState.version || ''}`}
          >
            {updateState.status === 'downloading' ? (
              <>
                <Download size={12} />
                <span>{Math.round(updateState.progress?.percent || 0)}%</span>
              </>
            ) : updateState.status === 'downloaded' || updateState.status === 'installing' ? (
              <RefreshCw size={15} />
            ) : (
              <Download size={15} />
            )}
          </button>
        </div>
      )}
      <div
        className="sidebar-toggle-area"
        onMouseEnter={handleToggleMouseEnter}
        onMouseLeave={handleToggleMouseLeave}
      >
        <button
          className={`sidebar-toggle-btn${toggleVisible ? ' sidebar-toggle-btn-visible' : ''}${sidebarCollapsed ? ' sidebar-toggle-btn-collapsed' : ''}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <SidebarToggleIcon collapsed={sidebarCollapsed} />
        </button>
      </div>
      <WorkspaceDialogs controller={workspace.dialogs} onDeleted={handleWorkspaceDeleted} />
      {showDaydream && <DaydreamOverlay onExit={closeDaydream} mode={daydreamMode} />}
    </div>
  )
}

export default AppShell
