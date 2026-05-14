import { useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import ProfileSwitcher from '../chat/ProfileSwitcher'

interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSettings: () => void
  children: React.ReactNode
}

function AgentPanel({ collapsed, onToggleCollapse, onOpenSettings, children }: AgentPanelProps): React.ReactElement {
  if (collapsed) {
    return (
      <div className="agent-panel agent-panel-collapsed">
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <MessageSquare size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <span className="agent-panel-title">Agent</span>
        <button className="agent-panel-toggle-btn" onClick={onToggleCollapse}>
          <X size={16} />
        </button>
      </div>
      <div className="agent-panel-content">
        <ProfileSwitcher onOpenSettings={onOpenSettings} />
        <div className="agent-panel-messages">
          {children}
        </div>
      </div>
    </div>
  )
}

export default AgentPanel