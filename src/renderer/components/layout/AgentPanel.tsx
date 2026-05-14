import { MessageSquare, X, Loader2 } from 'lucide-react'
import type { AgentStatus, UsageInfo } from '../../store/agent-store'
import ProfileSwitcher from '../chat/ProfileSwitcher'

interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSettings: () => void
  agentStatus: AgentStatus
  usageInfo: UsageInfo | null
  children: React.ReactNode
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: '',
  thinking: 'Thinking...',
  running: 'Running...',
  compacting: 'Compacting...',
  error: 'Error'
}

function AgentPanel({ collapsed, onToggleCollapse, onOpenSettings, agentStatus, usageInfo, children }: AgentPanelProps): React.ReactElement {
  if (collapsed) {
    return (
      <div className="agent-panel agent-panel-collapsed">
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <MessageSquare size={16} />
        </button>
      </div>
    )
  }

  const isActive = agentStatus !== 'idle' && agentStatus !== 'error'

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-header-left">
          <span className="agent-panel-title">Agent</span>
          {isActive && (
            <span className="agent-panel-status">
              <Loader2 size={12} className="agent-panel-spinner" />
              {STATUS_LABELS[agentStatus]}
            </span>
          )}
        </div>
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <X size={16} />
        </button>
      </div>
      <div className="agent-panel-content">
        <ProfileSwitcher onOpenSettings={onOpenSettings} />
        <div className="agent-panel-messages">
          {children}
        </div>
        {usageInfo && (
          <div className="agent-panel-footer">
            <span className="agent-panel-cost">
              ${usageInfo.costUsd.toFixed(4)}
            </span>
            <span className="agent-panel-tokens">
              {usageInfo.inputTokens + usageInfo.outputTokens} tokens
            </span>
            <span className="agent-panel-duration">
              {(usageInfo.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentPanel