import { useState, useCallback, useEffect, useRef } from 'react'
import { SidebarSimple, FileText } from '@phosphor-icons/react'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import GraphView from '../graph/GraphView'
import SearchPanel from '../search/SearchPanel'
import useAgent from '../../hooks/useAgent'
import type { ChatMessage } from '../../store/agent-store'
import type { FileEntry, SkillDefinition } from '../../lib/ipc'

interface AppShellProps {
  onOpenSettings: () => void
  settingsChangeKey: number
}

function AppShell({ onOpenSettings, settingsChangeKey }: AppShellProps): React.ReactElement {
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [toggleVisible, setToggleVisible] = useState(true)
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})
  const [prefillText, setPrefillText] = useState<string | null>(null)
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [showGraph, setShowGraph] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [editorStats, setEditorStats] = useState({ words: 0, chars: 0 })
  const [layoutMode, setLayoutMode] = useState<'edit-first' | 'chat-first'>('edit-first')
  const [linkedFile, setLinkedFile] = useState<string | null>(null)
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceError, setNewWorkspaceError] = useState('')
  const [modalVisible, setModalVisible] = useState(false)
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
        setLayoutMode((v) => v === 'edit-first' ? 'chat-first' : 'edit-first')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  // Menu bar actions
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
          setAgentCollapsed((v) => !v)
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

  const { messages, isStreaming, agentStatus, usageInfo, permissionRequest, askUserRequest, sessionList, currentSessionId, sendMessage, addMessage, respondPermission, respondAskUser, loadSessions, resumeSession, newSession, setActiveSkillInfo, activeSkillInfo, lastEditedFile } = useAgent()

  // Restore/refresh workspaces from settings
  useEffect(() => {
    window.api.settings.get().then((settings) => {
      const dirs = settings.authorizedDirectories
      setWorkspacePaths(dirs)
      const fileEntries: Record<string, FileEntry[]> = {}
      Promise.all(
        dirs.map(async (dir) => {
          fileEntries[dir] = await window.api.workspace.listFiles(dir)
        })
      ).then(() => setFiles(fileEntries))
    }).catch(() => {})
  }, [settingsChangeKey])

  const handleOpenDirectory = async () => {
    const path = await window.api.workspace.openDirectoryDialog()
    if (path && !workspacePaths.includes(path)) {
      setWorkspacePaths((prev) => [...prev, path])
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
    if (!isStreaming && messages.length > 0) {
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
    const skillInfo = { id: skill.id, name: skill.name, icon: skill.icon, status: 'running' as const }
    setActiveSkillInfo(skillInfo)
    const userMsg: ChatMessage = {
      id: `skill-${Date.now()}`,
      role: 'user',
      content: `执行 Skill: ${skill.name}`,
      skillInfo
    }
    addMessage(userMsg)
    sendMessage(prompt, linkedFile || undefined)
  }, [sendMessage, addMessage, setActiveSkillInfo, linkedFile])

  const activeContent = activeTab ? tabContents[activeTab] || '' : ''

  return (
    <div className="app-shell">
      <Sidebar
        files={files}
        workspacePaths={workspacePaths}
        memoryRefreshKey={memoryRefreshKey}
        onFileSelect={handleFileSelect}
        onOpenDirectory={handleOpenDirectory}
        onNewWorkspace={handleOpenNewWorkspaceModal}
        onRefreshWorkspace={handleRefreshWorkspace}
        onRemoveWorkspace={async (path) => {
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
        onToggleGraph={() => setShowGraph(!showGraph)}
        showGraph={showGraph}
        collapsed={sidebarCollapsed}
      />
      <div
        className={`main-content${sidebarCollapsed ? ' main-content-cover-sidebar' : ''}${layoutMode === 'chat-first' ? ' main-content-secondary' : ''}`}
      >
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
          <GraphView onNodeClick={(nodeId) => {
            handleFileSelect(nodeId)
            setShowGraph(false)
          }} />
        ) : activeTab ? (
          <MarkdownEditor
            key={activeTab}
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
        ) : (
          <div className="editor-empty">
            <FileText size={48} weight="thin" className="editor-empty-icon" />
            <span className="editor-empty-hint">选择文件或打开工作区</span>
          </div>
        )}
        </div>
        {activeTab && (
          <div className="editor-status-bar">
            <span>{editorStats.words} words</span>
            <span>{editorStats.chars} characters</span>
            {sourceMode && <span>Source</span>}
            {focusMode && <span>Focus</span>}
          </div>
        )}
      </div>
      <AgentPanel
        collapsed={agentCollapsed}
        onToggleCollapse={() => setAgentCollapsed(!agentCollapsed)}
        onSwapLayout={() => setLayoutMode((v) => v === 'edit-first' ? 'chat-first' : 'edit-first')}
        layoutMode={layoutMode}
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
        activeSkillInfo={activeSkillInfo}
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
        <ChatView messages={messages} onOpenFile={handleFileSelect} onSelectText={handleSelectText} />
      </AgentPanel>
      {showSearch && (
        <SearchPanel
          onOpenFile={handleFileSelect}
          onClose={() => setShowSearch(false)}
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
        >
          <SidebarSimple size={14} weight="light" />
        </button>
      </div>
      {showNewWorkspaceModal && (
        <div className={`app-modal-overlay${modalVisible ? ' app-modal-visible' : ''}`} onClick={handleCloseNewWorkspaceModal}>
          <div className={`app-modal${modalVisible ? ' app-modal-visible' : ''}`} onClick={(e) => e.stopPropagation()}>
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
    </div>
  )
}

export default AppShell