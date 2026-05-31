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
import { ErrorBoundary } from '../common/ErrorBoundary'
const GraphView = lazy(() => import('../graph/GraphView'))
import DaydreamOverlay from './DaydreamOverlay'
import { useAgent, useIPCSubscriptions, useIsStreaming, useMessages, usePermissionRequest, usePermissionQueueLength, useAskUserRequest, useCurrentSessionId, useUsageInfo, useSessionList, useAgentStatus, useLastEditedFile, useActiveSkillId } from '../../hooks/useAgent'
import { useDividerDrag } from '../../hooks/useDividerDrag'
import { useAppShortcuts } from '../../hooks/useAppShortcuts'
import { useAgentStore } from '../../store/agent-store-impl'
import { emptySlot } from '../../store/agent-store'
import type { AgentContext } from '../../../shared/types'
import { useGraphStore, useShowGraph, useChangedFileCount } from '../../store/graph-store'
import { useSettings } from '../../store/settings-cache'
import type { ChatMessage as ConversationMessage } from '../../store/agent-store'
import type { FileEntry, SkillDefinition } from '../../lib/ipc'

interface AppShellProps {
  onOpenSettings: () => void
}

function AppShell({ onOpenSettings }: AppShellProps): React.ReactElement {
  const modal = useModal()
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [fixedWorkspacePaths, setFixedWorkspacePaths] = useState<string[]>([])

  useEffect(() => {
    window.api.workspace.knowledgeDir().then(dir => {
      setFixedWorkspacePaths([dir])
    })
  }, [])
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [toggleVisible, setToggleVisible] = useState(true)
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [agentWidth, setAgentWidth] = useState(360)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const [isChatFirst, setIsChatFirst] = useState(false)

  const {
    dividerHovered,
    setDividerHovered,
    isDragging,
    handleSwapLayout,
    handleExpand,
    handleToggleAgent,
    handleDividerMouseDown,
  } = useDividerDrag({
    agentCollapsed,
    agentWidth,
    isChatFirst,
    setAgentWidth,
    setAgentCollapsed,
    shellRef,
    onSwapLayout: () => setIsChatFirst((v) => !v),
  })
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const showGraph = useShowGraph()
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const changedFileCount = useChangedFileCount()
  const [sourceMode, setSourceMode] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [editorStats, setEditorStats] = useState({ words: 0, chars: 0 })
  const [linkedFile, setLinkedFile] = useState<string | null>(null)
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false)
  const [deleteWsPath, setDeleteWsPath] = useState<string | null>(null)
  const [deleteWsConfirm, setDeleteWsConfirm] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceError, setNewWorkspaceError] = useState('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [showDaydream, setShowDaydream] = useState(false)
  const [daydreamMode, setDaydreamMode] = useState('matrix')
  const [showAskZuovis, setShowAskZuovis] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const editorRef = useRef<{ toggleSourceMode: () => void } | null>(null)

  // Keyboard shortcuts
  useAppShortcuts({ setShowSearch, setIsChatFirst })

  // Auto-link file when activeTab changes
  useEffect(() => {
    if (activeTab) {
      setLinkedFile(activeTab)
    }
  }, [activeTab])

  // Responsive: auto-collapse sidebar/agent panel at small widths
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      if (w < 900) {
        setSidebarCollapsed(true)
        setAgentWidth(0)
        setAgentCollapsed(true)
      } else if (w < 1200) {
        setSidebarCollapsed(true)
        if (agentCollapsed) {
          handleExpand()
        }
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [agentCollapsed])

  // Auto-hide sidebar toggle button after 3s
  useEffect(() => {
    toggleTimerRef.current = setTimeout(() => setToggleVisible(false), 3000)
    return () => {
      if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current)
    }
  }, [])

  const handleToggleMouseEnter = useCallback(() => {
    if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current)
    setToggleVisible(true)
  }, [])

  const handleToggleMouseLeave = useCallback(() => {
    toggleTimerRef.current = setTimeout(() => setToggleVisible(false), 3000)
  }, [])

  // Auto-update notifications
  useEffect(() => {
    const unsubAvailable = window.api.update.onAvailable((info) => setUpdateAvailable(info))
    const unsubDownloaded = window.api.update.onDownloaded(() => setUpdateDownloaded(true))
    return () => { unsubAvailable(); unsubDownloaded() }
  }, [])

  // Main process error listener
  const [mainError, setMainError] = useState<string | null>(null)
  useEffect(() => {
    const unsub = window.api.onMainError((error) => {
      console.error(`[Main ${error.type}]`, error.message)
      setMainError(error.message)
    })
    return unsub
  }, [])

  // Menu bar actions
  useEffect(() => {
    const unsub = window.api.graph.onFilesChanged((data) => {
      useGraphStore.getState().handleFilesChanged(data)
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.api.menu.onAction((action) => {
      switch (action) {
        case 'open-settings':
          onOpenSettings()
          break
        case 'toggle-sidebar':
          setSidebarCollapsed((v) => !v)
          break
        case 'toggle-agent-panel':
          handleToggleAgent()
          break
        case 'open-search':
          setShowSearch(true)
          break
        case 'toggle-source-mode':
          setSourceMode((v) => !v)
          break
        case 'toggle-focus-mode':
          setFocusMode((v) => !v)
          break
        case 'save-file':
          break
      }
    })
    return unsub
  }, [onOpenSettings])

  // Singleton IPC subscription — routes all events to correct store slot
  useIPCSubscriptions()

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

  const askIsStreaming = useIsStreaming('ask')
  const askMessages = useMessages('ask')

  const handleAskZuovisBack = useCallback(() => {
    if (askIsStreaming) window.api.agent.abort('ask')
    useAgentStore.setState((prev) => ({
      slots: { ...prev.slots, ask: emptySlot() },
    }))
  }, [askIsStreaming])

  // Restore/refresh workspaces from cached settings
  const settings = useSettings()
  const prevAuthDirsRef = useRef<string>('')
  useEffect(() => {
    if (!settings) return
    const dirs = settings.authorizedDirectories
    const key = dirs.join(',')
    if (key === prevAuthDirsRef.current) return
    prevAuthDirsRef.current = key
    setWorkspacePaths(dirs)
    const fileEntries: Record<string, FileEntry[]> = {}
    Promise.all(
      dirs.map(async (dir) => {
        fileEntries[dir] = await window.api.workspace.listFiles(dir)
      })
    ).then(() => setFiles(fileEntries))
  }, [settings])

  const handleOpenNewWorkspaceModal = () => {
    setNewWorkspaceName('')
    setNewWorkspaceError('')
    setShowNewWorkspaceModal(true)
    requestAnimationFrame(() => setModalVisible(true))
  }

  const handleCloseNewWorkspaceModal = () => {
    setModalVisible(false)
    setTimeout(() => {
      setShowNewWorkspaceModal(false)
      setNewWorkspaceName('')
      setNewWorkspaceError('')
      setIsCreatingWorkspace(false)
    }, 200)
  }

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim()
    if (!name) {
      setNewWorkspaceError('请输入工作区名称')
      return
    }
    if (/[/\\]/.test(name) || name.includes('..')) {
      setNewWorkspaceError('工作区名称不能包含 / \\ 或 ..')
      return
    }
    setIsCreatingWorkspace(true)
    setNewWorkspaceError('')
    try {
      const dirPath = await window.api.workspace.createWorkspace(name)
      if (dirPath) {
        if (!workspacePaths.includes(dirPath)) {
          setWorkspacePaths((prev) => [...prev, dirPath])
          const entries = await window.api.workspace.listFiles(dirPath)
          setFiles((prev) => ({ ...prev, [dirPath]: entries }))
          await window.api.settings.addDirectory(dirPath)
        }
        handleCloseNewWorkspaceModal()
      } else {
        setNewWorkspaceError('工作区已存在，请使用其他名称')
      }
    } catch {
      setNewWorkspaceError('创建工作区失败，请重试')
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  const handleRefreshWorkspace = useCallback(async (path: string) => {
    const entries = await window.api.workspace.listFiles(path)
    setFiles((prev) => ({ ...prev, [path]: entries }))
  }, [])

  const handleReorderWorkspaces = useCallback(async (paths: string[]) => {
    setWorkspacePaths(paths)
    await window.api.settings.reorderDirectories(paths)
  }, [])

  const handleFileSelect = useCallback(async (path: string) => {
    // Switch back to editor context when leaving Ask Zuovis
    if (showAskZuovis) {
      useAgentStore.setState({ context: 'editor' })
      setShowAskZuovis(false)
    }
    // If file is already open, just switch to it
    if (openTabs.includes(path)) {
      setActiveTab(path)
      return
    }

    // Read file content and add to tabs
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content !== undefined) {
      setOpenTabs((prev) => [...prev, path])
      setActiveTab(path)
      setTabContents((prev) => ({ ...prev, [path]: result.content! }))
    }
  }, [openTabs, showAskZuovis])

  const handleTabClose = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== path)
      // Switch to adjacent tab
      if (activeTab === path) {
        const closedIdx = prev.indexOf(path)
        const newActive = next[Math.min(closedIdx, next.length - 1)] || ''
        setActiveTab(newActive)
      }
      return next
    })
    setTabContents((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [activeTab])

  const handleFileDelete = useCallback(async (filePath: string) => {
    const result = await window.api.workspace.deleteFile(filePath)
    if (result.success) {
      if (openTabs.includes(filePath)) {
        handleTabClose(filePath)
      }
      const dirs = await window.api.settings.get().then(s => s.authorizedDirectories)
      const entries: Record<string, FileEntry[]> = {}
      await Promise.all(dirs.map(async (dir: string) => {
        entries[dir] = await window.api.workspace.listFiles(dir)
      }))
      setFiles(entries)
    } else {
      modal.alert({ title: '删除失败', message: result.error || '删除失败' })
    }
  }, [openTabs, handleTabClose])

  const handleFileRename = useCallback(async (filePath: string, newName: string) => {
    const result = await window.api.workspace.renameFile(filePath, newName)
    if (result.success) {
      if (openTabs.includes(filePath)) {
        const wsIdx = filePath.lastIndexOf('/')
        const wsPrefix = filePath.substring(0, wsIdx + 1)
        handleTabClose(filePath)
        if (result.newPath) {
          handleFileSelect(result.newPath)
        }
      }
      const dirs = await window.api.settings.get().then(s => s.authorizedDirectories)
      const entries: Record<string, FileEntry[]> = {}
      await Promise.all(dirs.map(async (dir: string) => {
        entries[dir] = await window.api.workspace.listFiles(dir)
      }))
      setFiles(entries)
    } else {
      modal.alert({ title: '重命名失败', message: result.error || '重命名失败' })
    }
  }, [openTabs, handleTabClose, handleFileSelect])

  const handleFileMove = useCallback(async (sourcePath: string, targetDir: string) => {
    const result = await window.api.workspace.moveFile(sourcePath, targetDir)
    if (result.success) {
      if (openTabs.includes(sourcePath)) {
        handleTabClose(sourcePath)
        if (result.newPath) {
          handleFileSelect(result.newPath)
        }
      }
      const dirs = await window.api.settings.get().then(s => s.authorizedDirectories)
      const entries: Record<string, FileEntry[]> = {}
      await Promise.all(dirs.map(async (dir: string) => {
        entries[dir] = await window.api.workspace.listFiles(dir)
      }))
      setFiles(entries)
    } else {
      modal.alert({ title: '移动失败', message: result.error || '移动失败' })
    }
  }, [openTabs, handleTabClose, handleFileSelect])

  const handleTabSwitch = useCallback((path: string) => {
    setActiveTab(path)
  }, [])

  const handleSave = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
    setTabContents((prev) => ({ ...prev, [filePath]: content }))
  }, [])

  // Auto-reload editor, memory, and sidebar file list when Agent finishes
  useEffect(() => {
    if (!isStreaming && useAgentStore.getState().slots.editor.messages.length > 0) {
      setMemoryRefreshKey((k) => k + 1)
      // Refresh sidebar file lists for all workspaces
      Promise.all(
        workspacePaths.map(async (dir) => {
          const entries = await window.api.workspace.listFiles(dir)
          return { dir, entries }
        })
      ).then((results) => {
        setFiles((prev) => {
          const next = { ...prev }
          for (const { dir, entries } of results) {
            next[dir] = entries
          }
          return next
        })
      })
      if (activeTab) {
        const timer = setTimeout(() => {
          window.api.workspace.readFile(activeTab).then((result) => {
            if (result.success && result.content !== undefined) {
              setTabContents((prev) => {
                if (prev[activeTab] !== result.content) {
                  return { ...prev, [activeTab]: result.content! }
                }
                return prev
              })
            }
          }).catch(() => {})
        }, 500)
        return () => clearTimeout(timer)
      }
    }
  }, [isStreaming, activeTab, workspacePaths])

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
        const target: AgentContext = showAskZuovis ? 'ask' : 'editor'
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
    [editorSendMessage]
  )

  const handleStatsUpdate = useCallback((words: number, chars: number) => {
    setEditorStats({ words, chars })
  }, [])

  const handleSkillSelect = useCallback((skill: SkillDefinition) => {
    const prompt = skill.promptTemplate.replace('{activeFile}', linkedFile || '')
    useAgentStore.setState((s) => ({
      slots: {
        ...s.slots,
        editor: {
          ...s.slots.editor,
          activeSkillId: skill.id,
          messages: [...s.slots.editor.messages, {
            id: `skill-${Date.now()}`,
            role: 'user',
            phase: 'complete',
            textContent: `执行 Skill: ${skill.name}`,
            content: [{ type: 'text', text: `执行 Skill: ${skill.name}` }],
            toolCalls: [],
            skillMeta: { id: skill.id, name: skill.name, icon: skill.icon, status: 'running' },
            createdAt: Date.now(),
          }],
        },
      },
    }))
    editorSendMessage(prompt, linkedFile || undefined)
  }, [editorSendMessage, linkedFile])

  const activeContent = activeTab ? tabContents[activeTab] || '' : ''

  return (
    <div className="app-shell" ref={shellRef}>
      <nav aria-label="侧边栏" style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        files={files}
        workspacePaths={workspacePaths}
        fixedWorkspacePaths={fixedWorkspacePaths}
        memoryRefreshKey={memoryRefreshKey}
        onFileSelect={handleFileSelect}
        onNewWorkspace={handleOpenNewWorkspaceModal}
        onFileDelete={handleFileDelete}
        onFileMove={handleFileMove}
        onFileRename={handleFileRename}
        onRefreshWorkspace={handleRefreshWorkspace}
        onRemoveWorkspace={(path) => { setDeleteWsPath(path); setDeleteWsConfirm('') }}
        onOpenSettings={onOpenSettings}
        onOpenSearch={() => setShowSearch(true)}
        onReorderWorkspaces={handleReorderWorkspaces}
        onToggleGraph={() => useGraphStore.getState().toggleGraph()}
        onDaydream={(mode: string) => { setDaydreamMode(mode); setShowDaydream(true) }}
        onAskZuovis={() => {
            useAgentStore.setState({ context: 'ask' })
            setActiveTab('')
            setShowAskZuovis(true)
          }}
        isAskZuovisActive={showAskZuovis}
        onAskZuovisBack={handleAskZuovisBack}
        isAskZuovisInChat={askMessages.length > 0}
        isAskZuovisRunning={askIsStreaming}
        activeFile={activeTab}
        showGraph={showGraph}
        changedFileCount={changedFileCount}
        collapsed={sidebarCollapsed}
      />
      </nav>
      <main className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${isChatFirst ? ' main-content-secondary' : ''}${showAskZuovis ? ' main-content-ask-zuovis' : ''}`}
           style={{ order: isChatFirst ? 2 : 0 }}
           aria-label="编辑器">
        {showAskZuovis ? (
          <AskZuovis
            onOpenFile={handleFileSelect}
            onSelectText={handleSelectText}
            workspacePath={workspacePaths[0]}
          />
        ) : (
        <>
        <div className={`main-content-header${sidebarCollapsed ? ' main-content-header-cover-sidebar' : ''}`}>
          {openTabs.length > 0 && (
            <EditorTabs
              tabs={openTabs}
              activeTab={activeTab}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
            />
          )}
        </div>
        <div className="main-content-scroll">
        {showGraph ? (
          <GraphView onNodeClick={(nodeId, nodeType) => {
            if (nodeType === 'entity') {
              const entityName = nodeId.replace(/^entity:/, '')
              setSearchQuery(entityName)
              setShowSearch(true)
            } else {
              handleFileSelect(nodeId)
            }
            useGraphStore.getState().setShowGraph(false)
          }} />
        ) : activeTab ? (
          <ErrorBoundary onReset={() => setActiveTab(activeTab)}>
          <MarkdownEditor
            content={activeContent}
            filePath={activeTab}
            workspacePath={workspacePaths[0] || ''}
            sourceMode={sourceMode}
            focusMode={focusMode}
            onOpenFile={handleFileSelect}
            onSave={handleSave}
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
      {!showAskZuovis && (
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
            <ArrowLeftRight size={12} />
          </button>
        )}
        {agentCollapsed && (
          <button className="divider-expand-btn" onClick={handleExpand} title="展开面板" aria-label="展开面板">
            <ChevronLeft size={12} />
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
        }} onSkillSelect={handleSkillSelect} onStop={() => window.api.agent.abort('editor')} disabled={(isStreaming && agentStatus !== 'waitingForUserInput') && !editorAskUser} isStreaming={isStreaming} placeholder={agentStatus === 'waitingForUserInput' ? '回答 Agent 的问题...' : undefined} />}
        linkedFile={linkedFile}
        onUnlinkFile={() => setLinkedFile(null)}
      >
        <ErrorBoundary>
        <ChatView context="editor" onOpenFile={handleFileSelect} onSelectText={handleSelectText} workspacePath={workspacePaths[0]} />
        </ErrorBoundary>
      </AgentPanel>
      </aside>
      </>
      )}
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
      {showNewWorkspaceModal && (
        <div className={`modal-overlay${modalVisible ? ' modal-overlay-visible' : ''}`} onClick={handleCloseNewWorkspaceModal}>
          <div className={`modal-window${modalVisible ? ' modal-window-visible' : ''}`} role="dialog" aria-modal="true" aria-label="新建工作区" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const focusable = e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])')
                if (!focusable.length) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault()
                  last.focus()
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault()
                  first.focus()
                }
              }
              if (e.key === 'Escape') handleCloseNewWorkspaceModal()
            }}
          >
            <div className="modal-title">新建工作区</div>
            <div className="modal-subtitle">将创建在 ~/Documents/VisionAgent/ 下</div>
            <input
              className="modal-input"
              placeholder="工作区名称"
              value={newWorkspaceName}
              onChange={(e) => { setNewWorkspaceName(e.target.value); setNewWorkspaceError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.isComposing && !isCreatingWorkspace) handleCreateWorkspace()
              }}
              disabled={isCreatingWorkspace}
              autoFocus
              aria-describedby={newWorkspaceError ? 'workspace-error' : undefined}
            />
            {newWorkspaceError && <div className="modal-error" id="workspace-error" role="alert">{newWorkspaceError}</div>}
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={handleCloseNewWorkspaceModal} disabled={isCreatingWorkspace}>取消</button>
              <button className="btn-modal btn-modal-primary" onClick={handleCreateWorkspace} disabled={isCreatingWorkspace}>
                {isCreatingWorkspace ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteWsPath && (
        <div className="modal-overlay modal-overlay-visible" onClick={() => setDeleteWsPath(null)}>
          <div className="modal-window modal-window-visible" role="dialog" aria-modal="true" aria-label="删除工作区" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">删除工作区</div>
            <div className="modal-body">
              此操作将永久删除工作区 <strong>{deleteWsPath.split('/').pop()}</strong> 及其所有文件，不可撤销。
            </div>
            <div className="modal-hint">请输入工作区名称以确认删除：</div>
            <input
              className="modal-input"
              placeholder={deleteWsPath.split('/').pop()}
              value={deleteWsConfirm}
              onChange={(e) => setDeleteWsConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDeleteWsPath(null)
                if (e.key === 'Enter' && !e.isComposing && deleteWsConfirm === deleteWsPath.split('/')?.pop()) {
                  (async () => {
                    const result = await window.api.workspace.deleteWorkspace(deleteWsPath)
                    if (result.success) {
                      setWorkspacePaths((prev) => prev.filter((p) => p !== deleteWsPath))
                      setFiles((prev) => {
                        const next = { ...prev }
                        delete next[deleteWsPath!]
                        return next
                      })
                      // Close tabs from deleted workspace
                      const wsPrefix = deleteWsPath + '/'
                      setOpenTabs((prev) => prev.filter((t) => !t.startsWith(wsPrefix)))
                      setDeleteWsPath(null)
                    } else {
                      modal.alert({ title: '删除失败', message: result.error || '删除失败' })
                    }
                  })()
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={() => setDeleteWsPath(null)}>取消</button>
              <button
                className="btn-modal btn-modal-primary btn-modal-danger"
                disabled={deleteWsConfirm !== deleteWsPath.split('/')?.pop()}
                onClick={async () => {
                  const result = await window.api.workspace.deleteWorkspace(deleteWsPath)
                  if (result.success) {
                    setWorkspacePaths((prev) => prev.filter((p) => p !== deleteWsPath))
                    setFiles((prev) => {
                      const next = { ...prev }
                      delete next[deleteWsPath!]
                      return next
                    })
                    const wsPrefix = deleteWsPath + '/'
                    setOpenTabs((prev) => prev.filter((t) => !t.startsWith(wsPrefix)))
                    setDeleteWsPath(null)
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