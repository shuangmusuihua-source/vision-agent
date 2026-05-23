import { useState, useRef, useEffect, useCallback } from 'react'
import { Sidebar as SidebarOpenIcon, SidebarSimple as SidebarIcon, ArrowsLeftRight, Plus, CaretDown, Spinner, X } from '@phosphor-icons/react'
import type { UsageInfo, PermissionRequestIPC as PermissionRequest, SdkSessionInfo } from '../../shared/types'
import type { AskUserRequestIPC as AskUserRequest } from '../../shared/types'
import type { SkillMeta } from '../../shared/types'
import type { AppSettings, ModelProfile } from '../../lib/ipc'
import { useAgentStore } from '../../store/agent-store-impl'
import PermissionDialog from '../chat/PermissionDialog'
import AskUserDrawer from '../chat/AskUserDrawer'
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
  askUserRequest: AskUserRequest | null
  onAskUserRespond: (requestId: string, answer: string) => void
  onAskUserDrawerRespond?: (answer: string) => void
  sessionList: SdkSessionInfo[]
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onRefreshSessions: () => void
  activeSkillId: string | null
  children: React.ReactNode
  chatInput: React.ReactNode
  linkedFile: string | null
  onUnlinkFile: () => void
}

function AgentPanel({ collapsed, onToggleCollapse, onSwapLayout, layoutMode, usageInfo, permissionRequest, onPermissionRespond, askUserRequest, onAskUserRespond, onAskUserDrawerRespond, sessionList, currentSessionId, onSelectSession, onNewSession, onRefreshSessions, activeSkillId, children, chatInput, linkedFile, onUnlinkFile }: AgentPanelProps): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [askDrawerOpen, setAskDrawerOpen] = useState(false)
  const [skillDrawerHidden, setSkillDrawerHidden] = useState(false)
  const [pendingAskAnswer, setPendingAskAnswer] = useState<{ requestId: string; answer: string } | null>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  // Open ask drawer when request arrives
  useEffect(() => {
    if (askUserRequest) setAskDrawerOpen(true)
  }, [askUserRequest])

  // Derive active skill meta from messages
  const activeSkillMeta = useAgentStore((s) => {
    if (!activeSkillId) return null
    for (let i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].skillMeta?.id === activeSkillId) return s.messages[i].skillMeta
    }
    return null
  })

  // Reset skill drawer visibility when a new skill starts
  useEffect(() => {
    if (activeSkillMeta?.status === 'running') setSkillDrawerHidden(false)
  }, [activeSkillMeta])

  // Send pending answer after close animation completes
  useEffect(() => {
    if (pendingAskAnswer && !askDrawerOpen) {
      onAskUserRespond(pendingAskAnswer.requestId, pendingAskAnswer.answer)
      setPendingAskAnswer(null)
    }
  }, [pendingAskAnswer, askDrawerOpen, onAskUserRespond])

  const handleAskUserRespond = useCallback((answer: string) => {
    if (!askUserRequest) return
    setPendingAskAnswer({ requestId: askUserRequest.id, answer })
    setAskDrawerOpen(false)
  }, [askUserRequest])

  // Expose handleAskUserRespond to parent via callback ref
  useEffect(() => {
    onAskUserDrawerRespond?.(handleAskUserRespond)
  }, [handleAskUserRespond, onAskUserDrawerRespond])
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
                        {s.lastModified ? new Date(s.lastModified).toLocaleDateString() : ''}
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
            <div className="agent-panel-messages">
            {activeSkillMeta && activeSkillMeta.status === 'running' && !skillDrawerHidden && (
              <div className="skill-status-bar">
                <Spinner size={14} className="skill-status-spinner" />
                <span className="skill-status-name">{activeSkillMeta.name}</span>
                <span className="skill-status-progress">执行中<span className="skill-status-dots"><span>.</span><span>.</span><span>.</span></span></span>
                <button className="skill-status-close" onClick={() => setSkillDrawerHidden(true)}>
                  <X size={14} />
                </button>
              </div>
            )}
            {children}
          </div>
          </div>
          <div className="agent-panel-footer">
            {permissionRequest && (
              <PermissionDialog
                request={permissionRequest}
                onRespond={onPermissionRespond}
              />
            )}
            {askUserRequest && (
              <AskUserDrawer
                request={askUserRequest}
                open={askDrawerOpen}
                onClose={() => setAskDrawerOpen(false)}
                onRespond={handleAskUserRespond}
              />
            )}
            <DrawerZone linkedFile={linkedFile} onUnlinkFile={onUnlinkFile} />
            {chatInput}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentPanel
