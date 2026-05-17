import { SidebarSimple as SidebarIcon } from '@phosphor-icons/react'
import type { UsageInfo, PermissionRequest, SdkSessionInfo } from '../../store/agent-store'
import ProfileSwitcher from '../chat/ProfileSwitcher'
import PermissionDialog from '../chat/PermissionDialog'
import SessionHistory from '../chat/SessionHistory'
import ContextZone from '../chat/ContextZone'
import DrawerZone from './DrawerZone'

interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSettings: () => void
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
  activeFilePath?: string
}

function AgentPanel({ collapsed, onToggleCollapse, onOpenSettings, usageInfo, permissionRequest, onPermissionRespond, sessionList, currentSessionId, onSelectSession, onNewSession, onRefreshSessions, children, chatInput, activeFilePath }: AgentPanelProps): React.ReactElement {
  if (collapsed) {
    return (
      <div className="agent-panel agent-panel-collapsed">
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <SidebarIcon size={16} weight="regular" />
        </button>
      </div>
    )
  }

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <SidebarIcon size={16} weight="regular" />
        </button>
      </div>
      <ContextZone activeFilePath={activeFilePath} />
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