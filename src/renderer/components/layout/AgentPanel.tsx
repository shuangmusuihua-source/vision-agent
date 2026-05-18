import { Sidebar as SidebarOpenIcon, SidebarSimple as SidebarIcon } from '@phosphor-icons/react'
import type { UsageInfo, PermissionRequest, SdkSessionInfo } from '../../store/agent-store'
import ProfileSwitcher from '../chat/ProfileSwitcher'
import SessionBar from '../chat/SessionBar'
import PermissionDialog from '../chat/PermissionDialog'
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
  return (
    <div className={`agent-panel${collapsed ? ' agent-panel-collapsed' : ''}`}>
      <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
        {collapsed ? <SidebarOpenIcon size={16} weight="regular" /> : <SidebarIcon size={16} weight="regular" />}
      </button>
      <div className="agent-panel-inner">
        <div className="agent-panel-header">
          <div className="agent-panel-header-left">
            <ContextZone activeFilePath={activeFilePath} />
          </div>
        </div>
        <SessionBar
          onOpenSettings={onOpenSettings}
          sessions={sessionList}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onNewSession={onNewSession}
          onRefreshSessions={onRefreshSessions}
        />
        <div className="agent-panel-body">
          <div className="agent-panel-content">
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
    </div>
  )
}

export default AgentPanel