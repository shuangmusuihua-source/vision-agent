import { useState, useRef, useEffect, useCallback } from 'react'
import { RotateCcw, Plus } from 'lucide-react'
import type { SdkSessionInfo } from '../../store/agent-store'
import type { AppSettings } from '../../lib/ipc'

const MODELS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

interface SessionBarProps {
  sessions: SdkSessionInfo[]
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onRefreshSessions: () => void
}

function SessionBar({ sessions, currentSessionId, onSelectSession, onNewSession, onRefreshSessions }: SessionBarProps): React.ReactElement {
  const [showHistory, setShowHistory] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const refreshSettings = useCallback(async () => {
    const s = await window.api.settings.get()
    setSettings(s)
  }, [])

  useEffect(() => { refreshSettings() }, [refreshSettings])

  useEffect(() => {
    if (!showHistory) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showHistory])

  const activeProfile = settings?.profiles.find(p => p.id === settings.activeProfileId)
  const modelLabel = activeProfile ? (MODELS[activeProfile.model] || activeProfile.model) : 'Sonnet 4'
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const sessionTitle = currentSession?.title || '新对话'

  return (
    <div className="session-bar">
      <div className="session-bar-left">
        <span className="session-bar-model">{modelLabel}</span>
      </div>
      <div className="session-bar-center" title={sessionTitle}>
        {sessionTitle}
      </div>
      <div className="session-bar-right">
        <button
          className="session-bar-btn"
          onClick={() => {
            setShowHistory(!showHistory)
            if (!showHistory) onRefreshSessions()
          }}
          title="历史会话"
        >
          <RotateCcw size={14} />
        </button>
        <button className="session-bar-btn" onClick={onNewSession} title="新建会话">
          <Plus size={14} />
        </button>
      </div>

      {showHistory && (
        <div className="session-bar-dropdown" ref={dropdownRef}>
          {sessions.length === 0 ? (
            <div className="session-bar-dropdown-empty">暂无历史会话</div>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                className={`session-bar-dropdown-item ${s.id === currentSessionId ? 'active' : ''}`}
                onClick={() => {
                  onSelectSession(s.id)
                  setShowHistory(false)
                }}
              >
                <span className="session-bar-dropdown-title">{s.title || '未命名会话'}</span>
                <span className="session-bar-dropdown-time">
                  {s.lastModified ? new Date(s.lastModified).toLocaleDateString() : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default SessionBar