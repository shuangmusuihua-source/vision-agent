import { Clock, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import type { SdkSessionInfo } from '../../store/agent-store'

interface SessionHistoryProps {
  sessions: SdkSessionInfo[]
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onRefresh: () => void
}

function SessionHistory({ sessions, currentSessionId, onSelectSession, onNewSession, onRefresh }: SessionHistoryProps): React.ReactElement {
  return (
    <div className="session-history">
      <div className="session-history-header">
        <span className="session-history-title">
          <Clock size={12} />
          History
        </span>
        <div className="session-history-actions">
          <button className="session-history-btn" onClick={onRefresh} title="Refresh">
            <RefreshCw size={12} />
          </button>
          <button className="session-history-btn" onClick={onNewSession} title="New session">
            <Plus size={12} />
          </button>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="session-history-empty">No sessions yet</div>
      ) : (
        <div className="session-history-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-history-item ${s.id === currentSessionId ? 'active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              <MessageSquare size={12} />
              <span className="session-history-item-title">
                {s.title || s.id.slice(0, 12)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default SessionHistory
