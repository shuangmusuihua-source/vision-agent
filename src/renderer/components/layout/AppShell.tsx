import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { PanelLeft, FileText, Download, ExternalLink, ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { useModal } from '../common/ModalSystem'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import SearchPanel from '../search/SearchPanel'
import AskZuovis from '../ask/AskZuovis'
import SessionHistoryPanel from './SessionHistoryPanel'
import ArtifactsPanel from './ArtifactsPanel'
import { ErrorBoundary } from '../common/ErrorBoundary'
const GraphFloat = lazy(() => import('../graph/GraphFloat'))
import DaydreamOverlay from './DaydreamOverlay'
import { useAgent, useIPCSubscriptions, useIsStreaming, useMessages, usePermissionRequest, usePermissionQueueLength, useAskUserRequest, useCurrentSessionId, useUsageInfo, useSessionList, useAgentStatus, useLastEditedFile, useActiveSkillId } from '../../hooks/useAgent'
import { useAppShortcuts } from '../../hooks/useAppShortcuts'
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useTabs } from '../../hooks/useTabs'
import { useAgentStore } from '../../store/agent-store-impl'
import { emptySlot } from '../../store/agent-store'
import type { AgentContext } from '../../../shared/types'
import { useGraphStore, useShowGraph, useChangedFileCount } from '../../store/graph-store'
import { useSettings } from '../../store/settings-cache'
import type { SkillDefinition } from '../../lib/ipc'

interface AppShellProps {
  onOpenSettings: () => void
}

function AppShell({ onOpenSettings }: AppShellProps): React.ReactElement {
  const modal = useModal()

  // ── Hooks: workspace, tabs ──────────────────────────────────────────

  const workspace = useWorkspace()
  const {
    openTabs, activeTab, activeContent,
    openFile, closeTab, switchTab, clearTab, closeTabsByPrefix,
    saveFile, refreshActiveContent,
  } = useTabs()
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)

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
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const changedFileCount = useChangedFileCount()
  const [sourceMode, setSourceMode] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [editorStats, setEditorStats] = useState({ words: 0, chars: 0 })
  const [linkedFile, setLinkedFile] = useState<string | null>(null)

  type PrimaryView = 'ask' | 'editor' | 'history' | 'artifacts'
  const [view, setView] = useState<PrimaryView>('ask')

  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const editorRef = useRef<{ toggleSourceMode: () => void } | null>(null)

  const [showDaydream, setShowDaydream] = useState(false)
  const [daydreamMode, setDaydreamMode] = useState('matrix')

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  useAppShortcuts({ setShowSearch, setIsChatFirst })

  // ── Auto-link active tab → linked file ──────────────────────────────

  useEffect(() => {
    if (activeTab) setLinkedFile(activeTab)
  }, [activeTab])

  // ── IPC subscriptions (update, menu, graph, main error) ─────────────

  useEffect(() => {
    const a = window.api.update.onAvailable((info) => setUpdateAvailable(info))
    const b = window.api.update.onDownloaded(() => setUpdateDownloaded(true))
    return () => { a(); b() }
  }, [])

  const [mainError, setMainError] = useState<string | null>(null)
  useEffect(() => {
    return window.api.onMainError((error) => {
      console.error(`[Main ${error.type}]`, error.message)
      setMainError(error.message)
    })
  }, [])

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const refreshActiveContentRef = useRef(refreshActiveContent)
  refreshActiveContentRef.current = refreshActiveContent

  useEffect(() => {
    return window.api.graph.onFilesChanged((data) => {
      useGraphStore.getState().handleFilesChanged(data)
      // Also refresh the editor if the active tab was modified externally
      const current = activeTabRef.current
      if (current && data.files.includes(current)) {
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
        case 'open-search': setShowSearch(true); break
        case 'toggle-source-mode': setSourceMode((v) => !v); break
        case 'toggle-focus-mode': setFocusMode((v) => !v); break
        case 'save-file': break
      }
    })
  }, [onOpenSettings])

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
  const isStreaming = useIsStreaming('editor')
  const editorPermission = usePermissionRequest('editor')
  const editorPermissionQueueLen = usePermissionQueueLength('editor')
  const editorAskUser = useAskUserRequest('editor')
  const editorAskUserRespondRef = useRef<((answer: string) => void) | null>(null)
  const currentSessionId = useCurrentSessionId('editor')
  const usageInfo = useUsageInfo('editor')
  const sessionList = useSessionList()
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
    workspace.syncFromSettings(settings.authorizedDirectories)
  }, [settings])

  // ── View routing helpers ────────────────────────────────────────────

  const handleAskZuovisBack = useCallback(() => {
    if (askIsStreaming) window.api.agent.abort('ask')
    useAgentStore.setState((prev) => ({
      slots: { ...prev.slots, ask: emptySlot() },
    }))
  }, [askIsStreaming])

  const handleSessionHistory = useCallback(() => {
    useAgentStore.setState({ context: 'editor' })
    setView('history')
    clearTab()
  }, [clearTab])

  const handleArtifacts = useCallback(() => {
    useAgentStore.setState({ context: 'editor' })
    setView('artifacts')
    clearTab()
  }, [clearTab])

  // ── File selection (bridges workspace + tabs) ───────────────────────

  const handleFileSelect = useCallback(async (path: string) => {
    if (view !== 'editor') {
      useAgentStore.setState({ context: 'editor' })
      setView('editor')
    }
    await openFile(path)
  }, [openFile, view])

  // ── File operations (bridging workspace + tabs) ─────────────────────

  const handleFileDelete = useCallback(async (filePath: string) => {
    const result = await window.api.workspace.deleteFile(filePath)
    if (result.success) {
      if (openTabs.includes(filePath)) closeTab(filePath)
      await workspace.refreshFiles(workspace.workspacePaths)
    } else {
      modal.alert({ title: '删除失败', message: result.error || '删除失败' })
    }
  }, [openTabs, closeTab, workspace, modal])

  const handleFileRename = useCallback(async (filePath: string, newName: string) => {
    const result = await window.api.workspace.renameFile(filePath, newName)
    if (result.success) {
      if (openTabs.includes(filePath)) {
        closeTab(filePath)
        if (result.newPath) await openFile(result.newPath)
      }
      await workspace.refreshFiles(workspace.workspacePaths)
    } else {
      modal.alert({ title: '重命名失败', message: result.error || '重命名失败' })
    }
  }, [openTabs, closeTab, openFile, workspace, modal])

  const handleFileMove = useCallback(async (sourcePath: string, targetDir: string) => {
    const result = await window.api.workspace.moveFile(sourcePath, targetDir)
    if (result.success) {
      if (openTabs.includes(sourcePath)) {
        closeTab(sourcePath)
        if (result.newPath) await openFile(result.newPath)
      }
      await workspace.refreshFiles(workspace.workspacePaths)
    } else {
      modal.alert({ title: '移动失败', message: result.error || '移动失败' })
    }
  }, [openTabs, closeTab, openFile, workspace, modal])

  // ── Auto-refresh after agent finishes ───────────────────────────────

  useEffect(() => {
    if (!isStreaming && useAgentStore.getState().slots.editor.messages.length > 0) {
      setMemoryRefreshKey((k) => k + 1)
      workspace.refreshAllFiles(workspace.workspacePaths)
      if (activeTab) {
        const timer = setTimeout(() => { refreshActiveContent().catch(() => {}) }, 500)
        return () => clearTimeout(timer)
      }
    }
  }, [isStreaming, activeTab, refreshActiveContent, workspace])

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
    const fileName = linkedFile ? linkedFile.split('/').pop() || linkedFile : ''
    const fileRef = fileName ? ` · ${fileName}` : ''
    const prompt = skill.promptTemplate.replace('{activeFile}', fileRef)
    useAgentStore.setState((s) => ({
      slots: {
        ...s.slots,
        editor: {
          ...s.slots.editor,
          activeSkillId: skill.id,
          messages: [...s.slots.editor.messages, {
            kind: 'user' as const,
            id: `skill-${Date.now()}`,
            role: 'user',
            textContent: `执行 Skill: ${skill.name}`,
            skillMeta: { id: skill.id, name: skill.name, icon: skill.icon, status: 'running' },
            createdAt: Date.now(),
          }],
        },
      },
    }))
    editorSendMessage(prompt, linkedFile || undefined)
  }, [editorSendMessage, linkedFile])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="app-shell" ref={shellRef}>
      <nav aria-label="侧边栏" style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        files={workspace.files}
        workspacePaths={workspace.workspacePaths}
        fixedWorkspacePaths={workspace.fixedWorkspacePaths}
        memoryRefreshKey={memoryRefreshKey}
        onFileSelect={handleFileSelect}
        onNewWorkspace={workspace.handleOpenNewWorkspaceModal}
        onFileDelete={handleFileDelete}
        onFileMove={handleFileMove}
        onFileRename={handleFileRename}
        onRefreshWorkspace={workspace.handleRefreshWorkspace}
        onRemoveWorkspace={workspace.handleRemoveWorkspace}
        onOpenSettings={onOpenSettings}
        onOpenSearch={() => setShowSearch(true)}
        onReorderWorkspaces={workspace.handleReorderWorkspaces}
        onToggleGraph={() => useGraphStore.getState().toggleGraph()}
        onDaydream={(mode: string) => { setDaydreamMode(mode); setShowDaydream(true) }}
        onAskZuovis={() => {
            useAgentStore.setState({ context: 'ask' })
            clearTab()
            setView('ask')
          }}
        isAskZuovisActive={view === 'ask'}
        onAskZuovisBack={handleAskZuovisBack}
        onSessionHistory={handleSessionHistory}
        isSessionHistoryActive={view === 'history'}
        onArtifacts={handleArtifacts}
        isArtifactsActive={view === 'artifacts'}
        isAskZuovisInChat={askMessages.length > 0}
        isAskZuovisRunning={askIsStreaming}
        activeFile={activeTab}
        showGraph={showGraph}
        changedFileCount={changedFileCount}
        collapsed={sidebarCollapsed}
      />
      </nav>
      <main className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${isChatFirst ? ' main-content-secondary' : ''}${view === 'ask' ? ' main-content-ask-zuovis' : ''}`}
           style={{ order: isChatFirst ? 2 : 0 }}
           aria-label="编辑器">
        {view === 'artifacts' ? (
          <ArtifactsPanel onOpenFile={handleFileSelect} />
        ) : view === 'history' ? (
          <SessionHistoryPanel />
        ) : view === 'ask' ? (
          <AskZuovis
            onOpenFile={handleFileSelect}
            onSelectText={handleSelectText}
            workspacePath={workspace.workspacePaths[0]}
          />
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
        {activeTab ? (
          <ErrorBoundary onReset={() => {}}>
          <MarkdownEditor
            content={activeContent}
            filePath={activeTab}
            workspacePath={workspace.workspacePaths[0] || ''}
            sourceMode={sourceMode}
            focusMode={focusMode}
            onOpenFile={handleFileSelect}
            onSave={saveFile}
            onAskAgent={handleAskAgent}
            onStatsUpdate={handleStatsUpdate}
          />
          </ErrorBoundary>
        ) : (
          <div className="editor-empty">
            <FileText size={48} className="editor-empty-icon" />
            <span className="editor-empty-hint">选择文件或打开工作区</span>
          </div>
        )}
        </div>
        {activeTab && (
          <div className="editor-status-bar" role="status">
            <span>{editorStats.words} words</span>
            <span>{editorStats.chars} characters</span>
            {sourceMode && <span>Source</span>}
            {focusMode && <span>Focus</span>}
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

      <aside style={{ display: agentCollapsed ? 'none' : 'flex', height: '100%', order: isChatFirst ? 0 : 2 }}>
      <AgentPanel
        width={agentWidth}
        edgeClass={isChatFirst ? 'agent-panel-edge-left' : 'agent-panel-edge-right'}
        usageInfo={usageInfo}
        permissionRequest={editorPermission}
        permissionQueueLength={editorPermissionQueueLen}
        onPermissionRespond={respondPermission}
        askUserRequest={editorAskUser}
        onAskUserRespond={editorRespondAskUser}
        onAskUserDrawerRespond={(respond) => { editorAskUserRespondRef.current = respond }}
        sessionList={sessionList}
        currentSessionId={currentSessionId}
        onSelectSession={resumeSession}
        onNewSession={newSession}
        onRefreshSessions={loadSessions}
        activeSkillId={activeSkillId}
        chatInput={<ChatInput context="editor" onSend={(msg) => {
          if (editorAskUser && editorAskUserRespondRef.current) {
            editorAskUserRespondRef.current(msg)
          } else {
            editorSendMessage(msg, linkedFile || undefined)
          }
        }} onSkillSelect={handleSkillSelect} onStop={() => {
            useAgentStore.getState().dispatchAgentEvent({ type: 'ABORT' }, 'editor')
            window.api.agent.abort('editor')
          }} disabled={(isStreaming && agentStatus !== 'waitingForUserInput') && !editorAskUser} isStreaming={isStreaming} placeholder={agentStatus === 'waitingForUserInput' ? '回答 Agent 的问题...' : undefined} />}
        linkedFile={linkedFile}
        onUnlinkFile={() => setLinkedFile(null)}
      >
        <ErrorBoundary>
        <ChatView context="editor" onOpenFile={handleFileSelect} onSelectText={handleSelectText} workspacePath={workspace.workspacePaths[0]} />
        </ErrorBoundary>
      </AgentPanel>
      </aside>
      </>
      )}
      {/* ── Banners ── */}
      {updateAvailable && !updateDownloaded && (
        <div className="update-banner">
          <span>新版本 v{updateAvailable.version} 可用</span>
          <button className="update-banner-btn" onClick={() => window.api.update.download()}>
            <Download size={14} /> 下载
          </button>
          <button className="update-banner-dismiss" onClick={() => setUpdateAvailable(null)}>✕</button>
        </div>
      )}
      {updateDownloaded && (
        <div className="update-banner update-banner-ready">
          <span>更新已就绪</span>
          <button className="update-banner-btn" onClick={() => window.api.update.install()}>
            <ExternalLink size={14} /> 重启安装
          </button>
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
          onClose={() => { setShowSearch(false); setSearchQuery('') }}
          initialQuery={searchQuery}
        />
      )}
      {showGraph && (
        <Suspense fallback={null}>
        <GraphFloat
          show={showGraph}
          onClose={() => useGraphStore.getState().setShowGraph(false)}
          activeFile={activeTab}
          onNodeClick={(nodeId, nodeType) => {
            if (nodeType === 'entity') {
              const entityName = nodeId.replace(/^entity:/, '')
              setSearchQuery(entityName)
              setShowSearch(true)
            } else {
              handleFileSelect(nodeId)
            }
            // Don't auto-close on node click — user can keep browsing
          }}
        />
        </Suspense>
      )}
      <div
        className="sidebar-toggle-area"
        onMouseEnter={handleToggleMouseEnter}
        onMouseLeave={handleToggleMouseLeave}
      >
        <button
          className={`sidebar-toggle-btn${toggleVisible ? ' sidebar-toggle-btn-visible' : ''}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <PanelLeft size={14} />
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
            <div className="modal-subtitle">将创建在 ~/Documents/VisionAgent/ 下</div>
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
                  } else {
                    modal.alert({ title: '删除失败', message: result.error || '删除失败' })
                  }
                }}
              >删除</button>
            </div>
          </div>
        </div>
      )}
      {showDaydream && <DaydreamOverlay onExit={() => setShowDaydream(false)} mode={daydreamMode} />}
    </div>
  )
}

export default AppShell
