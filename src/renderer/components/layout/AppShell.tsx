import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { SidebarSimple, FileText, Download, ArrowSquareOut, ArrowsLeftRight, CaretLeft } from '@phosphor-icons/react'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import SearchPanel from '../search/SearchPanel'
import { ErrorBoundary } from '../common/ErrorBoundary'
const GraphView = lazy(() => import('../graph/GraphView'))
import DaydreamOverlay from './DaydreamOverlay'
import { useAgent, useIsStreaming, usePermissionRequest, useAskUserRequest, useCurrentSessionId, useUsageInfo, useSessionList, useAgentStatus, useLastEditedFile, useActiveSkillId } from '../../hooks/useAgent'
import { useAgentStore } from '../../store/agent-store-impl'
import { useGraphStore, useShowGraph, useChangedFileCount } from '../../store/graph-store'
import { useSettings } from '../../store/settings-cache'
import type { ChatMessage as ConversationMessage } from '../../store/agent-store'
import type { FileEntry, SkillDefinition } from '../../lib/ipc'

const AGENT_DEFAULT_WIDTH = 360
const AGENT_MIN_WIDTH = 240
const AGENT_MAX_WIDTH = 500
const AGENT_COLLAPSE_THRESHOLD = 180
const EDITOR_MIN_RATIO = 0.30

interface AppShellProps {
  onOpenSettings: () => void
}

function AppShell({ onOpenSettings }: AppShellProps): React.ReactElement {
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [toggleVisible, setToggleVisible] = useState(true)
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [agentWidth, setAgentWidth] = useState(AGENT_DEFAULT_WIDTH)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const lastWidthRef = useRef(AGENT_DEFAULT_WIDTH)
  const [dividerHovered, setDividerHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const layoutWidthRef = useRef(0)
  const shellRef = useRef<HTMLDivElement>(null)
  const [isChatFirst, setIsChatFirst] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})
  const [prefillText, setPrefillText] = useState<string | null>(null)
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
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceError, setNewWorkspaceError] = useState('')
  const [modalVisible, setModalVisible] = useState(false)
  const [showDaydream, setShowDaydream] = useState(false)
  const [daydreamMode, setDaydreamMode] = useState('matrix')
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const askDrawerRespondRef = useRef<((answer: string) => void) | null>(null)
  const editorRef = useRef<{ toggleSourceMode: () => void } | null>(null)

  // Auto-link file when activeTab changes
  useEffect(() => {
    if (activeTab) {
      setLinkedFile(activeTab)
    }
  }, [activeTab])

  // Cmd+Shift+F to open search, Cmd+Shift+R to swap layout
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'r') {
        e.preventDefault()
        setIsChatFirst((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Divider: swap layout ──
  const handleSwapLayout = useCallback(() => {
    setIsChatFirst((v) => !v)
  }, [])

  // ── Divider: expand agent panel ──
  const handleExpand = useCallback(() => {
    setAgentWidth(lastWidthRef.current || AGENT_DEFAULT_WIDTH)
    setAgentCollapsed(false)
  }, [])

  // ── Divider: toggle agent panel (Cmd+Shift+B) ──
  const handleToggleAgent = useCallback(() => {
    if (agentCollapsed) {
      setAgentWidth(lastWidthRef.current || AGENT_DEFAULT_WIDTH)
      setAgentCollapsed(false)
    } else {
      lastWidthRef.current = agentWidth
      setAgentWidth(0)
      setAgentCollapsed(true)
    }
  }, [agentCollapsed, agentWidth])

  // ── Divider: drag to resize ──
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    if (agentCollapsed) return
    const target = e.target as HTMLElement
    if (target.closest('.divider-swap-btn') || target.closest('.divider-expand-btn')) return
    e.preventDefault()
    setIsDragging(true)
    setDividerHovered(true)
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = agentWidth
    layoutWidthRef.current = shellRef.current?.offsetWidth || window.innerWidth
  }, [agentCollapsed, agentWidth])

  useEffect(() => {
    if (!isDragging) return
    const onMouseMove = (e: MouseEvent) => {
      const delta = isChatFirst ? e.clientX - dragStartXRef.current : dragStartXRef.current - e.clientX
      const newWidth = Math.min(AGENT_MAX_WIDTH, Math.max(0, dragStartWidthRef.current + delta))
      const editorMinWidth = layoutWidthRef.current * EDITOR_MIN_RATIO
      const maxAgentWidth = layoutWidthRef.current - editorMinWidth
      const clamped = Math.min(newWidth, maxAgentWidth)
      if (clamped < AGENT_COLLAPSE_THRESHOLD) {
        lastWidthRef.current = dragStartWidthRef.current
        setAgentWidth(0)
        setAgentCollapsed(true)
        setIsDragging(false)
        setDividerHovered(false)
      } else {
        setAgentWidth(clamped)
        setAgentCollapsed(false)
      }
    }
    const onMouseUp = () => {
      setIsDragging(false)
      setDividerHovered(false)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, isChatFirst])

  useEffect(() => {
    if (agentCollapsed && agentWidth > 0) {
      lastWidthRef.current = agentWidth
    }
  }, [agentCollapsed, agentWidth])

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
          setAgentWidth(lastWidthRef.current || AGENT_DEFAULT_WIDTH)
          setAgentCollapsed(false)
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

  const {
    sendMessage,
    newSession,
    loadSessions,
    resumeSession,
    respondPermission,
    respondAskUser,
  } = useAgent()
  const isStreaming = useIsStreaming()
  const permissionRequest = usePermissionRequest()
  const askUserRequest = useAskUserRequest()
  const currentSessionId = useCurrentSessionId()
  const usageInfo = useUsageInfo()
  const sessionList = useSessionList()
  const agentStatus = useAgentStatus()
  const lastEditedFile = useLastEditedFile()
  const activeSkillId = useActiveSkillId()

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

  const handleOpenDirectory = async () => {
    const path = await window.api.workspace.openDirectoryDialog()
    if (path && !workspacePaths.includes(path)) {
      setWorkspacePaths((prev) => [path, ...prev])
      const entries = await window.api.workspace.listFiles(path)
      setFiles((prev) => ({ ...prev, [path]: entries }))
      await window.api.settings.addDirectory(path)
    }
  }

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
    }, 200)
  }

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      setNewWorkspaceError('请输入工作区名称')
      return
    }
    const dirPath = await window.api.workspace.createWorkspace(newWorkspaceName.trim())
    if (dirPath) {
      if (!workspacePaths.includes(dirPath)) {
        setWorkspacePaths((prev) => [...prev, dirPath])
        const entries = await window.api.workspace.listFiles(dirPath)
        setFiles((prev) => ({ ...prev, [dirPath]: entries }))
        await window.api.settings.addDirectory(dirPath)
      }
      handleCloseNewWorkspaceModal()
    } else {
      setNewWorkspaceError('工作区已存在或创建失败')
    }
  }

  const handleRefreshWorkspace = async (path: string) => {
    const entries = await window.api.workspace.listFiles(path)
    setFiles((prev) => ({ ...prev, [path]: entries }))
  }

  const handleFileSelect = useCallback(async (path: string) => {
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
  }, [openTabs])

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

  const handleTabSwitch = useCallback((path: string) => {
    setActiveTab(path)
  }, [])

  const handleSave = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
    setTabContents((prev) => ({ ...prev, [filePath]: content }))
  }, [])

  // Auto-reload editor and memory when Agent finishes
  useEffect(() => {
    if (!isStreaming && useAgentStore.getState().messages.length > 0) {
      setMemoryRefreshKey((k) => k + 1)
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
  }, [isStreaming, activeTab])

  const handleSelectText = useCallback((text: string) => {
    setPrefillText(text)
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
        setPrefillText(prompts.ask)
      } else {
        sendMessage(prompts[action], filePath)
      }
    },
    [sendMessage]
  )

  const handleStatsUpdate = useCallback((words: number, chars: number) => {
    setEditorStats({ words, chars })
  }, [])

  const handleSkillSelect = useCallback((skill: SkillDefinition) => {
    const prompt = skill.promptTemplate.replace('{activeFile}', linkedFile || '')
    useAgentStore.setState({ activeSkillId: skill.id })
    useAgentStore.setState((s) => ({
      messages: [...s.messages, {
        id: `skill-${Date.now()}`,
        role: 'user',
        phase: 'complete',
        textContent: `执行 Skill: ${skill.name}`,
        content: [{ type: 'text', text: `执行 Skill: ${skill.name}` }],
        toolCalls: [],
        skillMeta: { id: skill.id, name: skill.name, icon: skill.icon, status: 'running' },
        createdAt: Date.now(),
      }],
    }))
    sendMessage(prompt, linkedFile || undefined)
  }, [sendMessage, linkedFile])

  const activeContent = activeTab ? tabContents[activeTab] || '' : ''

  return (
    <div className="app-shell" ref={shellRef}>
      <nav aria-label="侧边栏" style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        files={files}
        workspacePaths={workspacePaths}
        memoryRefreshKey={memoryRefreshKey}
        onFileSelect={handleFileSelect}
        onOpenDirectory={handleOpenDirectory}
        onNewWorkspace={handleOpenNewWorkspaceModal}
        onRefreshWorkspace={handleRefreshWorkspace}
        onRemoveWorkspace={async (path) => {
          if (!window.confirm('确定移除此工作区？文件不会被删除，仅从侧栏移除。')) return
          setWorkspacePaths((prev) => prev.filter((p) => p !== path))
          setFiles((prev) => {
            const next = { ...prev }
            delete next[path]
            return next
          })
          await window.api.settings.removeDirectory(path)
        }}
        onOpenSettings={onOpenSettings}
        onOpenSearch={() => setShowSearch(true)}
        onReorderWorkspaces={async (paths) => {
          setWorkspacePaths(paths)
          await window.api.settings.reorderDirectories(paths)
        }}
        onToggleGraph={() => useGraphStore.getState().toggleGraph()}
        onDaydream={(mode: string) => { setDaydreamMode(mode); setShowDaydream(true) }}
        showGraph={showGraph}
        changedFileCount={changedFileCount}
        collapsed={sidebarCollapsed}
      />
      </nav>
      <main className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${isChatFirst ? ' main-content-secondary' : ''}`}
           style={{ order: isChatFirst ? 2 : 0 }}
           aria-label="编辑器">
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
            <FileText size={48} weight="thin" className="editor-empty-icon" />
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
      </main>
      {/* ── Divider Zone ── */}
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
            <ArrowsLeftRight size={12} weight="bold" />
          </button>
        )}
        {agentCollapsed && (
          <button className="divider-expand-btn" onClick={handleExpand} title="展开面板" aria-label="展开面板">
            <CaretLeft size={12} weight="bold" />
          </button>
        )}
      </div>

      <aside style={{ display: agentCollapsed ? 'none' : 'flex', height: '100%', order: isChatFirst ? 0 : 2 }}>
      <AgentPanel
        width={agentWidth}
        edgeClass={isChatFirst ? 'agent-panel-edge-left' : 'agent-panel-edge-right'}
        usageInfo={usageInfo}
        permissionRequest={permissionRequest}
        onPermissionRespond={respondPermission}
        askUserRequest={askUserRequest}
        onAskUserRespond={respondAskUser}
        onAskUserDrawerRespond={(respond) => { askDrawerRespondRef.current = respond }}
        sessionList={sessionList}
        currentSessionId={currentSessionId}
        onSelectSession={resumeSession}
        onNewSession={newSession}
        onRefreshSessions={loadSessions}
        activeSkillId={activeSkillId}
        chatInput={<ChatInput onSend={(msg) => {
          if (askUserRequest && askDrawerRespondRef.current) {
            askDrawerRespondRef.current(msg)
          } else {
            sendMessage(msg, linkedFile || undefined)
          }
        }} onSkillSelect={handleSkillSelect} disabled={isStreaming && agentStatus !== 'waitingForUserInput'} placeholder={agentStatus === 'waitingForUserInput' ? '回答 Agent 的问题...' : undefined} prefill={prefillText} onPrefillConsumed={() => setPrefillText(null)} />}
        linkedFile={linkedFile}
        onUnlinkFile={() => setLinkedFile(null)}
      >
        <ErrorBoundary>
        <ChatView onOpenFile={handleFileSelect} onSelectText={handleSelectText} workspacePath={workspacePaths[0]} />
        </ErrorBoundary>
      </AgentPanel>
      </aside>
      {updateAvailable && !updateDownloaded && (
        <div className="update-banner">
          <span>新版本 v{updateAvailable.version} 可用</span>
          <button className="update-banner-btn" onClick={() => window.api.update.download()}>
            <Download size={14} weight="bold" /> 下载
          </button>
          <button className="update-banner-dismiss" onClick={() => setUpdateAvailable(null)}>✕</button>
        </div>
      )}
      {updateDownloaded && (
        <div className="update-banner update-banner-ready">
          <span>更新已就绪</span>
          <button className="update-banner-btn" onClick={() => window.api.update.install()}>
            <ArrowSquareOut size={14} weight="bold" /> 重启安装
          </button>
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
          <SidebarSimple size={14} weight="light" />
        </button>
      </div>
      {showNewWorkspaceModal && (
        <div className={`app-modal-overlay${modalVisible ? ' app-modal-visible' : ''}`} onClick={handleCloseNewWorkspaceModal}>
          <div className={`app-modal${modalVisible ? ' app-modal-visible' : ''}`} role="dialog" aria-modal="true" aria-label="新建工作区" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-title">新建工作区</div>
            <input
              className="app-modal-input"
              placeholder="工作区名称"
              value={newWorkspaceName}
              onChange={(e) => { setNewWorkspaceName(e.target.value); setNewWorkspaceError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateWorkspace()
                if (e.key === 'Escape') handleCloseNewWorkspaceModal()
              }}
              autoFocus
            />
            {newWorkspaceError && <span className="app-modal-error">{newWorkspaceError}</span>}
            <div className="app-modal-actions">
              <button className="app-modal-cancel" onClick={handleCloseNewWorkspaceModal}>取消</button>
              <button className="app-modal-confirm" onClick={handleCreateWorkspace}>创建</button>
            </div>
          </div>
        </div>
      )}
      {showDaydream && <DaydreamOverlay onExit={() => setShowDaydream(false)} mode={daydreamMode} />}
    </div>
  )
}

export default AppShell