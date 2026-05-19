import { useState, useRef, useEffect, useCallback } from 'react'
import { Sidebar as SidebarOpenIcon, SidebarSimple as SidebarIcon, ArrowsLeftRight, Plus, CaretDown } from '@phosphor-icons/react'
import type { UsageInfo, PermissionRequest, SdkSessionInfo } from '../../store/agent-store'
import type { AppSettings, ModelProfile } from '../../lib/ipc'
import PermissionDialog from '../chat/PermissionDialog'
import DrawerZone from './DrawerZone'

const MODELS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

interface AgentPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onSwapLayout: () => void
  layoutMode: 'edit-first' | 'chat-first'
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
  linkedFile: string | null
  onUnlinkFile: () => void
}

function AgentPanel({ collapsed, onToggleCollapse, onSwapLayout, layoutMode, usageInfo, permissionRequest, onPermissionRespond, sessionList, currentSessionId, onSelectSession, onNewSession, onRefreshSessions, children, chatInput, linkedFile, onUnlinkFile }: AgentPanelProps): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showModelDropdown && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
      if (showHistory && historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelDropdown, showHistory])

  const activeProfile = settings?.profiles.find(p => p.id === settings.activeProfileId)
  const modelLabel = activeProfile ? (MODELS[activeProfile.model] || activeProfile.model) : 'Sonnet 4'

  const handleSelectModel = useCallback(async (profile: ModelProfile) => {
    await window.api.settings.setActiveProfile(profile.id)
    const s = await window.api.settings.get()
    setSettings(s)
    setShowModelDropdown(false)
  }, [])

  const handleToggleHistory = useCallback(() => {
    setShowHistory((v) => {
      if (!v) onRefreshSessions()
      return !v
    })
  }, [onRefreshSessions])

  return (
    <div className={`agent-panel${collapsed ? ' agent-panel-collapsed' : ''}${layoutMode === 'chat-first' ? ' agent-panel-primary' : ''}`}>
      {collapsed && (
        <button className="agent-panel-expand-btn" onClick={onToggleCollapse} title="展开面板">
          <SidebarOpenIcon size={14} weight="bold" />
        </button>
      )}
      <div className="agent-panel-inner">
        <div className="agent-panel-header">
          {/* Model selector */}
          <div className="agent-header-model" ref={modelDropdownRef}>
            <button className="agent-header-model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}>
              {modelLabel}
              <CaretDown size={10} weight="bold" />
            </button>
            {showModelDropdown && (
              <div className="agent-header-dropdown agent-header-model-dropdown">
                {settings?.profiles.map(p => (
                  <button
                    key={p.id}
                    className={`agent-header-dropdown-item${p.id === settings.activeProfileId ? ' active' : ''}`}
                    onClick={() => handleSelectModel(p)}
                  >
                    {MODELS[p.model] || p.model}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* New session + history */}
          <div className="agent-header-session" ref={historyDropdownRef}>
            <button className="agent-header-session-btn" onClick={onNewSession} title="新建会话">
              <Plus size={14} weight="bold" />
            </button>
            <button className="agent-header-session-arrow" onClick={handleToggleHistory} title="历史会话">
              <CaretDown size={10} weight="bold" />
            </button>
            {showHistory && (
              <div className="agent-header-dropdown agent-header-history-dropdown">
                {sessionList.length === 0 ? (
                  <div className="agent-header-dropdown-empty">暂无历史会话</div>
                ) : (
                  sessionList.map(s => (
                    <button
                      key={s.id}
                      className={`agent-header-dropdown-item${s.id === currentSessionId ? ' active' : ''}`}
                      onClick={() => { onSelectSession(s.id); setShowHistory(false) }}
                    >
                      <span className="agent-header-history-title">{s.title || '未命名会话'}</span>
                      <span className="agent-header-history-time">
                        {s.mtime ? new Date(s.mtime).toLocaleDateString() : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="agent-header-spacer" />

          {/* Swap + Collapse */}
          <button className="agent-header-btn" onClick={onSwapLayout} title={layoutMode === 'chat-first' ? '对话为主' : '编辑为主'}>
            <ArrowsLeftRight size={14} weight="bold" />
          </button>
          <button className="agent-header-btn" onClick={onToggleCollapse} title="折叠面板">
            <SidebarIcon size={14} weight="bold" />
          </button>
        </div>
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
            <DrawerZone linkedFile={linkedFile} onUnlinkFile={onUnlinkFile} />
            {chatInput}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentPanel
