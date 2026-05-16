import { Sidebar as SidebarIcon } from 'lucide-react'
import type { AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo } from '../../store/agent-store'
import ProfileSwitcher from '../chat/ProfileSwitcher'
import PermissionDialog from '../chat/PermissionDialog'
import SessionHistory from '../chat/SessionHistory'
import DrawerZone from './DrawerZone'

interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSettings: () => void
  agentStatus: AgentStatus
  usageInfo: UsageInfo | null
  permissionRequest: PermissionRequest | null
  onPermissionRespond: (requestId: string, behavior: 'allow' | 'deny') => void
  sessionList: SdkSessionInfo[]
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onRefreshSessions: () => void
  children: React.ReactNode
  chatInput: React.ReactNode
}

function AgentPanel({ collapsed, onToggleCollapse, onOpenSettings, agentStatus, usageInfo, permissionRequest, onPermissionRespond, sessionList, currentSessionId, onSelectSession, onNewSession, onRefreshSessions, children, chatInput }: AgentPanelProps): React.ReactElement {
  if (collapsed) {
    return (
      <div className="agent-panel agent-panel-collapsed">
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <SidebarIcon size={16} />
        </button>
      </div>
    )
  }

  const isActive = agentStatus !== 'idle'

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-header-left">
          <span className={`agent-status-dot ${isActive ? 'active' : ''}`} />
          <span className={`agent-status-label ${isActive ? 'active' : ''}`}>
            {agentStatus === 'thinking' ? 'Thinking' :
             agentStatus === 'running' ? 'Running' :
             agentStatus === 'compacting' ? 'Compacting' :
             agentStatus === 'error' ? 'Error' : ''}
          </span>
        </div>
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <SidebarIcon size={16} />
        </button>
      </div>
      <div className="agent-panel-body">
        <div className="agent-panel-content">
          <ProfileSwitcher onOpenSettings={onOpenSettings} />
          <SessionHistory
            sessions={sessionList}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onNewSession={onNewSession}
            onRefresh={onRefreshSessions}
          />
          {permissionRequest && (
            <PermissionDialog
              request={permissionRequest}
              onRespond={onPermissionRespond}
            />
          )}
          <div className="agent-panel-messages">
            {children}
          </div>
        </div>
        <div className="agent-panel-footer">
          <DrawerZone />
          {chatInput}
          {usageInfo && (
            <div className="agent-usage">
              <span>${usageInfo.costUsd.toFixed(4)}</span>
              {(usageInfo.inputTokens + usageInfo.outputTokens) > 0 && (
                <span>{((usageInfo.inputTokens + usageInfo.outputTokens) / 1000).toFixed(1)}k tokens</span>
              )}
              {usageInfo.durationMs > 0 && (
                <span>{(usageInfo.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AgentPanel