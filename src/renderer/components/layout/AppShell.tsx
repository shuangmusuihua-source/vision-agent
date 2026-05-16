import { useState, useCallback, useEffect } from 'react'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import GraphView from '../graph/GraphView'
import SearchPanel from '../search/SearchPanel'
import useAgent from '../../hooks/useAgent'
import type { FileEntry } from '../../lib/ipc'

interface AppShellProps {
  onOpenSettings: () => void
  settingsChangeKey: number
}

function AppShell({ onOpenSettings, settingsChangeKey }: AppShellProps): React.ReactElement {
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})
  const [prefillText, setPrefillText] = useState<string | null>(null)
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [showGraph, setShowGraph] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // Cmd+Shift+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
      }
    })
    return unsub
  }, [onOpenSettings])

  const { messages, isStreaming, agentStatus, usageInfo, permissionRequest, sessionList, currentSessionId, sendMessage, respondPermission, loadSessions, resumeSession, newSession } = useAgent()

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

  const handleFileSelect = async (path: string) => {
    // If file is already open, just switch to it
    if (openTabs.includes(path)) {
      setActiveTab(path)
      return
    }

    // Read file content and add to tabs
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content) {
      setOpenTabs((prev) => [...prev, path])
      setActiveTab(path)
      setTabContents((prev) => ({ ...prev, [path]: result.content! }))
    }
  }

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
            if (result.success && result.content) {
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
        sendMessage(prompts[action])
      }
    },
    [sendMessage]
  )

  const activeContent = activeTab ? tabContents[activeTab] || '' : ''

  return (
    <div className="app-shell">
      <Sidebar
        files={files}
        workspacePaths={workspacePaths}
        memoryRefreshKey={memoryRefreshKey}
        onFileSelect={handleFileSelect}
        onOpenDirectory={handleOpenDirectory}
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
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-content">
        <div className="main-content-header">
          {openTabs.length > 0 && (
            <EditorTabs
              tabs={openTabs}
              activeTab={activeTab}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
            />
          )}
          {workspacePaths.length > 0 && (
            <button
              className={`graph-toggle-btn ${showGraph ? 'graph-toggle-active' : ''}`}
              onClick={() => setShowGraph(!showGraph)}
              title="Toggle graph view"
            >
              Graph
            </button>
          )}
        </div>
        {showGraph ? (
          <GraphView onNodeClick={(nodeId) => {
            handleFileSelect(nodeId)
            setShowGraph(false)
          }} />
        ) : activeTab ? (
          <MarkdownEditor
            content={activeContent}
            filePath={activeTab}
            workspacePath={workspacePaths[0] || ''}
            onOpenFile={handleFileSelect}
            onSave={handleSave}
            onAskAgent={handleAskAgent}
          />
        ) : (
          <div className="editor-empty">
            <p>Select a file from the sidebar or open a workspace</p>
          </div>
        )}
      </div>
      <AgentPanel
        collapsed={agentCollapsed}
        onToggleCollapse={() => setAgentCollapsed(!agentCollapsed)}
        onOpenSettings={onOpenSettings}
        agentStatus={agentStatus}
        usageInfo={usageInfo}
        permissionRequest={permissionRequest}
        onPermissionRespond={respondPermission}
        sessionList={sessionList}
        currentSessionId={currentSessionId}
        onSelectSession={resumeSession}
        onNewSession={newSession}
        onRefreshSessions={loadSessions}
        chatInput={<ChatInput onSend={sendMessage} disabled={isStreaming} prefill={prefillText} onPrefillConsumed={() => setPrefillText(null)} />}
      >
        <ChatView messages={messages} />
      </AgentPanel>
      {showSearch && (
        <SearchPanel
          onOpenFile={handleFileSelect}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  )
}

export default AppShell