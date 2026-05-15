import { useState, useCallback } from 'react'
import Sidebar from './Sidebar'
import AgentPanel from './AgentPanel'
import MarkdownEditor from '../editor/MarkdownEditor'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
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
  const [currentFile, setCurrentFile] = useState('')
  const [currentContent, setCurrentContent] = useState('')

  const { messages, isStreaming, agentStatus, usageInfo, permissionRequest, sendMessage, respondPermission } = useAgent()

  const handleOpenDirectory = async () => {
    const path = await window.api.workspace.openDirectoryDialog()
    if (path) {
      setWorkspacePath(path)
      const entries = await window.api.workspace.listFiles(path)
      setFiles(entries)
    }
  }

  const handleFileSelect = async (path: string) => {
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content) {
      setCurrentFile(path)
      setCurrentContent(result.content)
    }
  }

  const handleSave = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
  }, [])

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
        {currentFile ? (
          <MarkdownEditor
            content={currentContent}
            filePath={currentFile}
            onSave={handleSave}
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
      >
        <ChatView messages={messages} />
        <ChatInput onSend={sendMessage} disabled={isStreaming} />
      </AgentPanel>
    </div>
  )
}

export default AppShell