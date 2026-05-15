import { useState, useCallback, useEffect } from 'react'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import EditorTabs from '../editor/EditorTabs'
import useAgent from '../../hooks/useAgent'
import type { FileEntry } from '../../lib/ipc'

interface AppShellProps {
  onOpenSettings: () => void
}

function AppShell({ onOpenSettings }: AppShellProps): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [workspacePath, setWorkspacePath] = useState('')
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})
  const [prefillText, setPrefillText] = useState<string | null>(null)

  const { messages, isStreaming, agentStatus, usageInfo, permissionRequest, sessionList, currentSessionId, sendMessage, respondPermission, loadSessions, resumeSession, newSession } = useAgent()

  const handleOpenDirectory = async () => {
    const path = await window.api.workspace.openDirectoryDialog()
    if (path) {
      setWorkspacePath(path)
      const entries = await window.api.workspace.listFiles(path)
      setFiles(entries)
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

  // Auto-reload editor when Agent finishes (may have edited the current file)
  useEffect(() => {
    if (!isStreaming && activeTab && messages.length > 0) {
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
        workspacePath={workspacePath}
        onFileSelect={handleFileSelect}
        onOpenDirectory={handleOpenDirectory}
        onOpenSettings={onOpenSettings}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-content">
        {openTabs.length > 0 && (
          <EditorTabs
            tabs={openTabs}
            activeTab={activeTab}
            onTabSwitch={handleTabSwitch}
            onTabClose={handleTabClose}
          />
        )}
        {activeTab ? (
          <MarkdownEditor
            content={activeContent}
            filePath={activeTab}
            workspacePath={workspacePath}
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
      >
        <ChatView messages={messages} />
        <ChatInput onSend={sendMessage} disabled={isStreaming} prefill={prefillText} onPrefillConsumed={() => setPrefillText(null)} />
      </AgentPanel>
    </div>
  )
}

export default AppShell