import { useState, useCallback, useEffect } from 'react'
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
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content) {
      setCurrentFile(path)
      setCurrentContent(result.content)
    }
  }

  const handleSave = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
  }, [])

  // Auto-reload editor when Agent finishes (may have edited the current file)
  useEffect(() => {
    if (!isStreaming && currentFile && messages.length > 0) {
      // Small delay to ensure file write is complete
      const timer = setTimeout(() => {
        window.api.workspace.readFile(currentFile).then((result) => {
          if (result.success && result.content && result.content !== currentContent) {
            setCurrentContent(result.content)
          }
        }).catch(() => {})
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, currentFile])

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