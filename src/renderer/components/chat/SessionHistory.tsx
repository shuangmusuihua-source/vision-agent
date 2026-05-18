import { useState } from 'react'
import { Clock, ChatCircle, Plus, ArrowsClockwise, CaretDown, CaretRight } from '@phosphor-icons/react'
import type { SdkSessionInfo } from '../../store/agent-store'

interface SessionHistoryProps {
  sessions: SdkSessionInfo[]
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onRefresh: () => void
}

function SessionHistory({ sessions, currentSessionId, onSelectSession, onNewSession, onRefresh }: SessionHistoryProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="session-history">
      <div className="session-history-header">
        <button
          className="session-history-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <CaretRight size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
          <Clock size={12} weight="bold" />
          <span className="session-history-title">History</span>
        </button>
        <div className="session-history-actions">
          <button className="session-history-btn" onClick={onRefresh} title="Refresh">
            <ArrowsClockwise size={12} weight="bold" />
          </button>
          <button className="session-history-btn" onClick={onNewSession} title="New session">
            <Plus size={12} weight="bold" />
          </button>
        </div>
      </div>
      {!collapsed && (
        sessions.length === 0 ? (
          <div className="session-history-empty">No sessions yet</div>
        ) : (
          <div className="session-history-list">
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`session-history-item ${s.id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSelectSession(s.id)}
              >
                <ChatCircle size={12} weight="bold" />
                <span className="session-history-item-title">
                  {s.title || s.id.slice(0, 12)}
                </span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}

export default SessionHistory