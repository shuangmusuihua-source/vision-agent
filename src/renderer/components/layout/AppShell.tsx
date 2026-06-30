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
import { useAgent, useIPCSubscriptions, useIsStreaming, useMessages, usePermissionRequest, usePermissionQueueLength, useAskUserRequest, useCurrentSessionId, useUsageInfo, useSessionList, useAgentStatus, useLastEditedFile, useActiveSkillId } from '../../hooks/useAgent'
import { useAppShortcuts } from '../../hooks/useAppShortcuts'
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useTabs, type SaveFileResult } from '../../hooks/useTabs'
import { useAgentStore } from '../../store/agent-store-impl'
import { emptySlot } from '../../store/agent-store'
import type { AgentContext, FileEntry, TabDescriptor } from '../../../shared/types'
import { isFileTab, isOverviewTab, OVERVIEW_TAB_ID, type SdkSessionInfo } from '../../../shared/types'
import { DOCUMENTS_DIR_NAME } from '../../../shared/branding'
import { filterUserWorkspacePaths, findContainingWorkspacePath } from '../../../shared/workspace-paths'
import { useGraphStore, useShowGraph, useChangedFileCount } from '../../store/graph-store'
import { useSettings } from '../../store/settings-cache'
import type { SkillDefinition } from '../../lib/ipc'
import { buildSkillInvocationPrompt } from '../../../shared/skill-invocation'
import { checkForAppUpdates, getUpdateProgressLabel, performPrimaryUpdateAction } from '../../lib/app-update'
import type { MarkdownEditorHandle } from '../editor/MarkdownEditor'

const MarkdownEditor = lazy(() => import('../editor/MarkdownEditor'))
const ChatView = lazy(() => import('../chat/ChatView'))
const GraphFloat = lazy(() => import('../graph/GraphFloat'))
const SkillLibrary = lazy(() => import('../skills/SkillLibrary'))

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

  // ── Hooks: workspace, tabs ──────────────────────────────────────────

  const workspace = useWorkspace()
  const {
    openTabs, activeTab, activeContent, activeFilePath,
    openFile, openFixedTab, closeTab, switchTab, clearTab, closeTabsByPrefix,
    saveFile, retryPendingSave, refreshActiveContent, hasFileTab,
    activeSaveError, activeHasPendingSave,
  } = useTabs()
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [isRetryingSave, setIsRetryingSave] = useState(false)
  const activeFilePathRef = useRef(activeFilePath)
  activeFilePathRef.current = activeFilePath

  // Stable refs for workspace values used in useCallback/useEffect deps
  // (the workspace object changes every render — avoid putting it in dep arrays)
  const workspacePathsRef = useRef(workspace.workspacePaths)
  workspacePathsRef.current = workspace.workspacePaths
  const refreshAllFilesRef = useRef(workspace.refreshAllFiles)
  refreshAllFilesRef.current = workspace.refreshAllFiles
  const refreshFilesRef = useRef(workspace.refreshFiles)
  refreshFilesRef.current = workspace.refreshFiles
  const visibleWorkspacePathsRef = useRef<string[]>([])
  visibleWorkspacePathsRef.current = [...workspace.fixedWorkspacePaths, ...workspace.workspacePaths]

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

  const showGraph = useShowGraph()
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

  const flushActiveEditorForPath = useCallback(async (path: string, includeChildren = false) => {
    const activePath = activeFilePathRef.current
    const matches = includeChildren ? activePath.startsWith(`${path}/`) : activePath === path
    if (!matches) return true
    try {
      await editorRef.current?.flushPendingSave()
      return true
    } catch (error) {
      await modal.alert({
        title: '保存失败',
        message: `文件尚未安全保存，已取消后续操作：${(error as Error).message}`,
      })
      return false
    }
  }, [modal])

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
    useAgentStore.setState((state) => {
      const sessionId = state.activeSessionId.editor || state.slots.editor.currentSessionId
      const nextEditorSlot = { ...state.slots.editor, linkedFile: path }
      if (!sessionId) {
        return {
          slots: { ...state.slots, editor: nextEditorSlot },
        }
      }

      const existingSlot = state.sessionSlots[sessionId] || nextEditorSlot
      return {
        slots: { ...state.slots, editor: nextEditorSlot },
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: { ...existingSlot, linkedFile: path },
        },
      }
    })
  }, [setLinkedFile])

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
      const sdkSessionId = useAgentStore.getState().sessionSlots[activeSessionId]?.sdkSessionId
        || useAgentStore.getState().sessionList.find(s => s.id === activeSessionId)?.sdkSessionId
        || (activeSessionId.startsWith('new-') ? null : activeSessionId)
      if (!sdkSessionId) {
        useAgentStore.getState().setSessionOutputs(null)
        return
      }
      useAgentStore.setState({ sessionOutputsLoading: true })
      window.api.agent.getSessionOutputs(activeSessionId).then((outputs) => {
        if (useAgentStore.getState().activeSessionId.editor === activeSessionId) {
          useAgentStore.getState().setSessionOutputs(outputs)
        }
      }).catch(() => {
        if (useAgentStore.getState().activeSessionId.editor === activeSessionId) {
          useAgentStore.getState().setSessionOutputs(null)
        }
      })
    } else {
      useAgentStore.getState().setSessionOutputs(null)
    }
  }, [activeSessionId])

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
      useAgentStore.setState({ context: 'editor' })
      setView('editor')
    }
    const overviewTab = openTabs.find(t => t.type === 'fixed')
    if (overviewTab) switchTab(overviewTab)
  }, [activeWorkspacePath, view, openTabs, switchTab, setLinkedFile])

  const { creatingSessionIn, setCreatingSessionIn, newSessionName, setNewSessionName } = useUiStore()
  const newSessionInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creatingSessionIn) {
      setNewSessionName('')
      setTimeout(() => newSessionInputRef.current?.focus(), 50)
    }
  }, [creatingSessionIn])

  const handleCreateSession = useCallback(async (wsPath: string) => {
    const name = newSessionName.trim()
    if (!name) return
    if (wsPath !== activeWorkspacePath) {
      skipNextSessionLoad.current = true
    }
    // Create a new empty editor slot with a placeholder session ID and store the title
    const tempSessionId = `new-${Date.now()}`
    useAgentStore.getState().switchToSession(tempSessionId, 'editor', wsPath)
    setEditorLinkedFile(null)
    if (wsPath !== activeWorkspacePath) {
      useAgentStore.getState().setActiveWorkspace(wsPath)
    }
    // Store the user-chosen title in the session slot so sidebar can show it
    useAgentStore.setState((s) => ({
      sessionSlots: {
        ...s.sessionSlots,
        [tempSessionId]: {
          ...(s.sessionSlots[tempSessionId] || s.slots.editor),
          currentSessionId: tempSessionId,
          sdkSessionId: null,
        },
      },
    }))
    // Add to sessionList via the protocol — single write path
    useAgentStore.getState().dispatchSessionList({
      type: 'CREATE_TEMP',
      sessionId: tempSessionId,
      title: name,
      workspacePath: wsPath,
    })
    // Persist immediately so empty named sessions survive restart even
    // before the first message is sent (which creates the real SDK session).
    window.api.agent.updateSessionRecord(tempSessionId, {
      title: name,
      workspacePath: wsPath,
      context: 'editor',
      status: 'empty',
      createdAt: Date.now(),
      lastModified: Date.now(),
      messageCount: 0,
      artifactCount: 0,
    }).catch(() => {})
    setCreatingSessionIn(null)
    if (view !== 'editor') {
      useAgentStore.setState({ context: 'editor' })
      setView('editor')
    }
  }, [newSessionName, activeWorkspacePath, view, setEditorLinkedFile])

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
    newSession,
    loadSessions,
    resumeSession,
    respondPermission,
    respondAskUser: editorRespondAskUser,
  } = useAgent('editor')

  const handleDeleteSession = useCallback(async (sessionId: string, workspacePath: string) => {
    const ok = await modal.confirm({
      title: '删除会话',
      message: '确定删除此会话？会话中的所有对话记录将被永久删除，此操作不可撤销。',
      variant: 'danger',
    })
    if (!ok) return
    const wasActive = useAgentStore.getState().activeSessionId.editor === sessionId

    // Abort any running query for this session before deletion.
    // Without this, a streaming session's SDK subprocess keeps running,
    // writing events to a deleted session file — resource leak + potential
    // session file recreation on disk.
    const slot = useAgentStore.getState().sessionSlots[sessionId]
    if (slot?.isStreaming || (wasActive && useAgentStore.getState().slots.editor.isStreaming)) {
      window.api.agent.abort(sessionId).catch(() => {})
    }

    const sdkSessionId = slot?.sdkSessionId
      || useAgentStore.getState().sessionList.find(s => s.id === sessionId)?.sdkSessionId
      || (sessionId.startsWith('new-') ? null : sessionId)

    if (!sdkSessionId) {
      useAgentStore.getState().dispatchSessionList({ type: 'DELETE', sessionId })
      window.api.agent.removeSessionRecord(sessionId).catch(() => {})
    } else {
      try {
        await window.api.agent.deleteSession(sdkSessionId)
        useAgentStore.getState().dispatchSessionList({ type: 'DELETE', sessionId })
        window.api.agent.removeSessionRecord(sessionId).catch(() => {})
      } catch (err) {
        console.error('[AppShell] deleteSession error:', err)
        modal.alert({ title: '删除失败', message: '无法删除会话，请稍后重试' })
        return
      }
    }
    // Remove the deleted session's cached slot from sessionSlots
    useAgentStore.setState((s) => {
      const { [sessionId]: _, ...rest } = s.sessionSlots
      return { sessionSlots: rest }
    })
    if (wasActive) {
      useAgentStore.getState().switchToSession('')
      useAgentStore.getState().setSessionOutputs(null)
      setEditorLinkedFile(null)
      if (view !== 'editor') {
        setView('editor')
      }
    }
  }, [modal, view, loadSessions, setEditorLinkedFile])

  const isStreaming = useIsStreaming('editor')
  const prevIsStreamingRef = useRef(isStreaming)
  const editorPermission = usePermissionRequest('editor')
  const editorPermissionQueueLen = usePermissionQueueLength('editor')
  const editorAskUser = useAskUserRequest('editor')
  const editorAskUserRespondRef = useRef<((answers: Record<string, string>) => void) | null>(null)
  const currentSessionId = useCurrentSessionId('editor')
  const usageInfo = useUsageInfo('editor')
  const sessionList = useSessionList()
  const editorSessionList = sessionList.filter((s) => s.context !== 'ask')
  const handleAgentPanelSessionSelect = useCallback((sessionId: string) => {
    const target = editorSessionList.find((session) => session.id === sessionId)
    if (target?.workspacePath || target?.cwd) {
      handleSessionSelect(sessionId, target.workspacePath || target.cwd || activeWorkspacePath || '')
      return
    }
    resumeSession(sessionId)
    setLinkedFile(useAgentStore.getState().slots.editor.linkedFile || null)
  }, [activeWorkspacePath, editorSessionList, handleSessionSelect, resumeSession, setLinkedFile])
  const agentStatus = useAgentStatus('editor')
  const lastEditedFile = useLastEditedFile('editor')
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
    useAgentStore.setState((prev) => ({
      slots: { ...prev.slots, ask: emptySlot() },
      activeSessionId: { ...prev.activeSessionId, ask: null },
    }))
  }, [askIsStreaming])

  // ── File selection (bridges workspace + tabs) ───────────────────────

  const handleFileSelect = useCallback(async (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase()
    // PDF and HTML slides — open with system default app, not in-editor
    if (ext === 'pdf' || ext === 'html' || ext === 'htm') {
      window.api.workspace.openInBrowser(path)
      return
    }
    if (view !== 'editor') {
      useAgentStore.setState({ context: 'editor' })
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
  }, [openFile, view, workspace.fixedWorkspacePaths, workspace.workspacePaths])

  // ── File operations (bridging workspace + tabs) ─────────────────────

  const handleFileDelete = useCallback(async (filePath: string) => {
    const confirmed = await modal.confirm({
      title: '删除文件',
      message: '确定删除此文件？此操作不可撤销。',
      variant: 'danger',
    })
    if (!confirmed) return
    if (!await flushActiveEditorForPath(filePath)) return
    const result = await window.api.workspace.deleteFile(filePath)
    if (result.success) {
      if (hasFileTab(filePath)) closeTab({ type: 'file', path: filePath })
      await refreshFilesRef.current(visibleWorkspacePathsRef.current)
    } else {
      modal.alert({ title: '删除失败', message: result.error || '删除失败' })
    }
  }, [closeTab, flushActiveEditorForPath, hasFileTab, modal])

  const handleFileRename = useCallback(async (filePath: string, newName: string) => {
    if (!await flushActiveEditorForPath(filePath)) return
    const result = await window.api.workspace.renameFile(filePath, newName)
    if (result.success) {
      if (hasFileTab(filePath)) {
        closeTab({ type: 'file', path: filePath })
        if (result.newPath) await openFile(result.newPath)
      }
      await refreshFilesRef.current(visibleWorkspacePathsRef.current)
    } else {
      modal.alert({ title: '重命名失败', message: result.error || '重命名失败' })
    }
  }, [closeTab, flushActiveEditorForPath, hasFileTab, modal, openFile])

  const handleFileMove = useCallback(async (sourcePath: string, targetDir: string) => {
    if (!await flushActiveEditorForPath(sourcePath)) return
    const result = await window.api.workspace.moveFile(sourcePath, targetDir)
    if (result.success) {
      if (hasFileTab(sourcePath)) {
        closeTab({ type: 'file', path: sourcePath })
        if (result.newPath) await openFile(result.newPath)
      }
      await refreshFilesRef.current(visibleWorkspacePathsRef.current)
    } else {
      modal.alert({ title: '移动失败', message: result.error || '移动失败' })
    }
  }, [closeTab, flushActiveEditorForPath, hasFileTab, modal, openFile])

  const handleCreateFile = useCallback(async (parentPath: string, name: string) => {
    const result = await window.api.workspace.createFile(parentPath, name)
    if (!result.success) {
      await modal.alert({ title: '新建失败', message: result.error || '无法新建文件' })
      return
    }
    await refreshFilesRef.current(visibleWorkspacePathsRef.current)
    if (result.path) await handleFileSelect(result.path)
  }, [handleFileSelect, modal])

  const handleCreateDirectory = useCallback(async (parentPath: string, name: string) => {
    const result = await window.api.workspace.createDir(parentPath, name)
    if (!result.success) {
      await modal.alert({ title: '新建失败', message: result.error || '无法新建文件夹' })
      return
    }
    await refreshFilesRef.current(visibleWorkspacePathsRef.current)
  }, [modal])

  const handleRenameEntry = useCallback(async (entry: FileEntry, name: string) => {
    if (!entry.isDirectory) {
      await handleFileRename(entry.path, name)
      return
    }
    if (!await flushActiveEditorForPath(entry.path, true)) return
    const result = await window.api.workspace.renameEntry(entry.path, name)
    if (!result.success) {
      await modal.alert({ title: '重命名失败', message: result.error || '重命名失败' })
      return
    }
    closeTabsByPrefix(`${entry.path}/`)
    await refreshFilesRef.current(visibleWorkspacePathsRef.current)
  }, [closeTabsByPrefix, flushActiveEditorForPath, handleFileRename, modal])

  const handleDeleteEntry = useCallback(async (entry: FileEntry) => {
    if (!entry.isDirectory) {
      await handleFileDelete(entry.path)
      return
    }
    const confirmed = await modal.confirm({
      title: '删除文件夹',
      message: `确定删除“${entry.name}”及其中全部内容？此操作不可撤销。`,
      variant: 'danger',
    })
    if (!confirmed) return
    if (!await flushActiveEditorForPath(entry.path, true)) return
    const result = await window.api.workspace.deleteDir(entry.path)
    if (!result.success) {
      await modal.alert({ title: '删除失败', message: result.error || '删除失败' })
      return
    }
    closeTabsByPrefix(`${entry.path}/`)
    await refreshFilesRef.current(visibleWorkspacePathsRef.current)
  }, [closeTabsByPrefix, flushActiveEditorForPath, handleFileDelete, modal])

  // ── Auto-refresh after agent finishes ───────────────────────────────

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    prevIsStreamingRef.current = isStreaming
    // Only trigger on streaming → idle transition (agent just finished)
    if (!wasStreaming || isStreaming) return
    const hasMessages = useAgentStore.getState().slots.editor.messages.length > 0
    if (!hasMessages) return

    setMemoryRefreshKey((k) => k + 1)
    refreshAllFilesRef.current(workspacePathsRef.current)

    // Refresh session outputs so OverviewPanel shows newly produced files
    const sid = useAgentStore.getState().activeSessionId.editor
    if (sid) {
      const sdkSessionId = useAgentStore.getState().sessionSlots[sid]?.sdkSessionId
        || useAgentStore.getState().sessionList.find(s => s.id === sid)?.sdkSessionId
        || (sid.startsWith('new-') ? null : sid)
      if (!sdkSessionId) return
      window.api.agent.getSessionOutputs(sid).then((outputs) => {
        if (useAgentStore.getState().activeSessionId.editor === sid) {
          useAgentStore.getState().setSessionOutputs(outputs)
        }
      }).catch(() => {})
    }

    const tab = activeTabRef.current
    if (tab && isFileTab(tab)) {
      const timer = setTimeout(() => { refreshActiveContentRef.current().catch(() => {}) }, 500)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  // ── Text selection, ask-agent, stats, skill ─────────────────────────

  const handleSelectText = useCallback((text: string, sourceContext?: string) => {
    const target: AgentContext = sourceContext === 'ask' ? 'ask' : 'editor'
    useAgentStore.setState((prev) => ({
      slots: {
        ...prev.slots,
        [target]: { ...prev.slots[target], prefillText: text },
      },
    }))
  }, [])

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
        useAgentStore.setState((prev) => ({
          slots: {
            ...prev.slots,
            [target]: { ...prev.slots[target], prefillText: prompts.ask },
          },
        }))
      } else {
        editorSendMessage(prompts[action], filePath)
      }
    },
    [editorSendMessage, view]
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

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="app-shell" ref={shellRef}>
      <nav aria-label="侧边栏" style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        workspacePaths={workspace.workspacePaths}
        fixedWorkspacePaths={workspace.fixedWorkspacePaths}
        files={workspace.files}
        memoryRefreshKey={memoryRefreshKey}
        sessions={editorSessionList}
        activeSessionId={view === 'editor' ? activeSessionId : null}
        activeSessionRunning={isStreaming}
        onSessionSelect={handleSessionSelect}
        onDeleteSession={handleDeleteSession}
        onNewConversation={(wsPath) => setCreatingSessionIn(wsPath)}
        onCancelNewSession={() => setCreatingSessionIn(null)}
        creatingSessionIn={creatingSessionIn}
        newSessionName={newSessionName}
        onNewSessionNameChange={setNewSessionName}
        onCreateSession={handleCreateSession}
        newSessionInputRef={newSessionInputRef}
        onNewWorkspace={workspace.handleOpenNewWorkspaceModal}
        onRemoveWorkspace={workspace.handleRemoveWorkspace}
        onRefreshWorkspace={workspace.handleRefreshWorkspace}
        onOpenFile={handleFileSelect}
        onCreateFile={handleCreateFile}
        onCreateDirectory={handleCreateDirectory}
        onRenameEntry={handleRenameEntry}
        onDeleteEntry={handleDeleteEntry}
        onMoveFile={handleFileMove}
        onReorderWorkspaces={workspace.handleReorderWorkspaces}
        onOpenSettings={onOpenSettings}
        onOpenSearch={() => openSearch()}
        onToggleGraph={() => useGraphStore.getState().toggleGraph()}
        onDaydream={(mode: string) => openDaydream(mode)}
        onAskZuovis={() => {
            useAgentStore.setState({ context: 'ask' })
            clearTab()
            setView('ask')
          }}
        isAskZuovisActive={view === 'ask'}
        onOpenSkills={() => setView('skills')}
        isSkillsActive={view === 'skills'}
        onAskZuovisBack={handleAskZuovisBack}
        isAskZuovisInChat={askMessages.length > 0}
        isAskZuovisRunning={askIsStreaming}
        showGraph={showGraph}
        changedFileCount={changedFileCount}
        collapsed={sidebarCollapsed}
      />
      </nav>
      <main className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${isChatFirst ? ' main-content-secondary' : ''}${view === 'ask' ? ' main-content-ask-zuovis' : ''}${view === 'skills' ? ' main-content-skills' : ''}`}
           style={{ order: isChatFirst ? 2 : 0 }}
           aria-label={view === 'skills' ? '技能' : view === 'ask' ? 'Ask sumi' : '编辑器'}>
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
        usageInfo={usageInfo}
        permissionRequest={editorPermission}
        permissionQueueLength={editorPermissionQueueLen}
        onPermissionRespond={respondPermission}
        askUserRequest={editorAskUser}
        onAskUserRespond={editorRespondAskUser}
        onAskUserDrawerRespond={(respond) => { editorAskUserRespondRef.current = respond }}
        sessionList={editorSessionList}
        currentSessionId={currentSessionId}
        onSelectSession={handleAgentPanelSessionSelect}
        onNewSession={newSession}
        onRefreshSessions={loadSessions}
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
      {updateError && (
        <div className="update-banner" style={{ background: 'rgba(255, 71, 87, 0.12)', border: '1px solid rgba(255, 71, 87, 0.3)' }}>
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
        <div className="update-banner" style={{ background: 'rgba(255, 71, 87, 0.12)', border: '1px solid rgba(255, 71, 87, 0.3)' }}>
          <span>会话加载失败: {sessionLoadError.message.slice(0, 60)}{sessionLoadError.message.length > 60 ? '...' : ''}</span>
          <button className="update-banner-btn" onClick={() => { void retrySessionLoad() }}>
            <RefreshCw size={14} /> 重试
          </button>
          <button className="update-banner-dismiss" onClick={clearSessionLoadError}>✕</button>
        </div>
      )}
      {mainError && (
        <div className="update-banner" style={{ background: 'rgba(255, 71, 87, 0.12)', border: '1px solid rgba(255, 71, 87, 0.3)' }}>
          <span>应用错误: {mainError.slice(0, 80)}{mainError.length > 80 ? '...' : ''}</span>
          <button className="update-banner-dismiss" onClick={() => setMainError(null)}>✕</button>
        </div>
      )}
      {showSearch && (
        <SearchPanel
          onOpenFile={handleFileSelect}
          onClose={() => closeSearchPanel()}
          initialQuery={searchQuery}
        />
      )}
      {showGraph && (
        <Suspense fallback={null}>
        <GraphFloat
          show={showGraph}
          onClose={() => useGraphStore.getState().setShowGraph(false)}
          activeFile={activeFilePath}
          onNodeClick={(nodeId, nodeType) => {
            if (nodeType === 'entity') {
              const entityName = nodeId.replace(/^entity:/, '')
              openSearch(entityName)
            } else {
              handleFileSelect(nodeId)
            }
            // Don't auto-close on node click — user can keep browsing
          }}
        />
        </Suspense>
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
      {/* ── New workspace modal ── */}
      {workspace.showNewWorkspaceModal && (
        <div className={`modal-overlay${workspace.modalVisible ? ' modal-overlay-visible' : ''}`} onClick={workspace.handleCloseNewWorkspaceModal}>
          <div className={`modal-window${workspace.modalVisible ? ' modal-window-visible' : ''}`} role="dialog" aria-modal="true" aria-label="新建工作区" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const focusable = e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])')
                if (!focusable.length) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
              }
              if (e.key === 'Escape') workspace.handleCloseNewWorkspaceModal()
            }}
          >
            <div className="modal-title">新建工作区</div>
            <div className="modal-subtitle">将创建在 ~/Documents/{DOCUMENTS_DIR_NAME}/ 下</div>
            <input
              className="modal-input"
              placeholder="工作区名称"
              value={workspace.newWorkspaceName}
              onChange={(e) => { workspace.setNewWorkspaceName(e.target.value); workspace.setNewWorkspaceError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.isComposing && !workspace.isCreatingWorkspace) workspace.handleCreateWorkspace()
              }}
              disabled={workspace.isCreatingWorkspace}
              autoFocus
              aria-describedby={workspace.newWorkspaceError ? 'workspace-error' : undefined}
            />
            {workspace.newWorkspaceError && <div className="modal-error" id="workspace-error" role="alert">{workspace.newWorkspaceError}</div>}
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={workspace.handleCloseNewWorkspaceModal} disabled={workspace.isCreatingWorkspace}>取消</button>
              <button className="btn-modal btn-modal-primary" onClick={workspace.handleCreateWorkspace} disabled={workspace.isCreatingWorkspace}>
                {workspace.isCreatingWorkspace ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Delete workspace modal ── */}
      {workspace.deleteWsPath && (
        <div className="modal-overlay modal-overlay-visible" onClick={() => workspace.setDeleteWsPath(null)}>
          <div className="modal-window modal-window-visible" role="dialog" aria-modal="true" aria-label="删除工作区" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">删除工作区</div>
            <div className="modal-body">
              此操作将永久删除工作区 <strong>{workspace.deleteWsPath.split('/').pop()}</strong> 及其所有文件，不可撤销。
            </div>
            <div className="modal-hint">请输入工作区名称以确认删除：</div>
            <input
              className="modal-input"
              placeholder={workspace.deleteWsPath.split('/').pop()}
              value={workspace.deleteWsConfirm}
              onChange={(e) => workspace.setDeleteWsConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') workspace.setDeleteWsPath(null)
                if (e.key === 'Enter' && !e.isComposing && workspace.deleteWsConfirm === workspace.deleteWsPath!.split('/')?.pop()) {
                  (async () => {
                    const deletingPath = workspace.deleteWsPath
                    if (!deletingPath) return
                    const result = await workspace.handleDeleteWorkspace()
                    if (!result.success) {
                      modal.alert({ title: '删除失败', message: result.error || '删除失败' })
                    } else {
                      closeTabsByPrefix(deletingPath + '/')
                      const remaining = workspace.workspacePaths.filter(p => p !== deletingPath)
                      useAgentStore.getState().setActiveWorkspace(remaining[0] || null)
                    }
                  })()
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={() => workspace.setDeleteWsPath(null)}>取消</button>
              <button
                className="btn-modal btn-modal-primary btn-modal-danger"
                disabled={workspace.deleteWsConfirm !== workspace.deleteWsPath.split('/')?.pop()}
                onClick={async () => {
                  const deletingPath = workspace.deleteWsPath
                  if (!deletingPath) return
                  const result = await workspace.handleDeleteWorkspace()
                  if (result.success) {
                    closeTabsByPrefix(deletingPath + '/')
                    const remaining = workspace.workspacePaths.filter(p => p !== deletingPath)
                    useAgentStore.getState().setActiveWorkspace(remaining[0] || null)
                  } else {
                    modal.alert({ title: '删除失败', message: result.error || '删除失败' })
                  }
                }}
              >删除</button>
            </div>
          </div>
        </div>
      )}
      {showDaydream && <DaydreamOverlay onExit={closeDaydream} mode={daydreamMode} />}
    </div>
  )
}

export default AppShell
