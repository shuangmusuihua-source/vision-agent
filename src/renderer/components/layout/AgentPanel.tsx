import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, ChevronDown, X } from 'lucide-react'
import type { UsageInfo, PermissionRequestIPC as PermissionRequest, AskUserRequestIPC as AskUserRequest, SdkSessionInfo } from '../../../shared/types'
import type { AgentContext } from '../../../shared/types'
import type { SkillMeta } from '../../../shared/types'
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
  context?: AgentContext
  width: number
  edgeClass: string
  workspacePath?: string
  usageInfo: UsageInfo | null
  permissionRequest: PermissionRequest | null
  permissionQueueLength: number
  onPermissionRespond: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => void
  askUserRequest: AskUserRequest | null
  onAskUserRespond: (requestId: string, answers: Record<string, string>) => void
  onAskUserDrawerRespond?: (respond: (answers: Record<string, string>) => void) => void
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

function AgentPanel({ context = 'editor', width, edgeClass, workspacePath, usageInfo, permissionRequest, permissionQueueLength, onPermissionRespond, askUserRequest, onAskUserRespond, onAskUserDrawerRespond, sessionList, currentSessionId, onSelectSession, onNewSession, onRefreshSessions, activeSkillId, children, chatInput, linkedFile, onUnlinkFile }: AgentPanelProps): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [askDrawerOpen, setAskDrawerOpen] = useState(false)
  const [skillDrawerHidden, setSkillDrawerHidden] = useState(false)
  const [pendingAskAnswer, setPendingAskAnswer] = useState<{ requestId: string; answers: Record<string, string> } | null>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  useEffect(() => {
    if (askUserRequest) setAskDrawerOpen(true)
  }, [askUserRequest])

  useEffect(() => {
    if (pendingAskAnswer && !askDrawerOpen) {
      onAskUserRespond(pendingAskAnswer.requestId, pendingAskAnswer.answers)
      setPendingAskAnswer(null)
    }
  }, [pendingAskAnswer, askDrawerOpen, onAskUserRespond])

  const handleAskUserRespond = useCallback((answers: Record<string, string>) => {
    if (!askUserRequest) return
    setPendingAskAnswer({ requestId: askUserRequest.id, answers })
    setAskDrawerOpen(false)
  }, [askUserRequest])

  useEffect(() => {
    onAskUserDrawerRespond?.(handleAskUserRespond)
  }, [handleAskUserRespond, onAskUserDrawerRespond])

  const activeSkillMeta = useAgentStore((s) => {
    if (!activeSkillId) return null
    const msgs = s.slots[context].messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.kind === 'user' || msg.kind === 'text') {
        if (msg.skillMeta?.id === activeSkillId) return msg.skillMeta
      }
    }
    return null
  })

  useEffect(() => {
    if (activeSkillMeta?.status === 'running') setSkillDrawerHidden(false)
  }, [activeSkillMeta])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showModelDropdown && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelDropdown])

  const activeProfile = settings?.profiles.find(p => p.id === settings.activeProfileId)
  const modelLabel = activeProfile ? (MODELS[activeProfile.model] || activeProfile.model) : 'Sonnet 4'

  const handleSelectModel = useCallback(async (profile: ModelProfile) => {
    await window.api.settings.setActiveProfile(profile.id)
    const s = await window.api.settings.get()
    setSettings(s)
    setShowModelDropdown(false)
  }, [])

  return (
    <div className={`agent-panel ${edgeClass}`} style={{ width, minWidth: width, maxWidth: width }}>
      <div className="agent-panel-inner">
        <div className="agent-panel-header">
          <div className="agent-header-model" ref={modelDropdownRef}>
            <button className="agent-header-model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)} aria-label="选择模型">
              {modelLabel}
              <ChevronDown size={12} />
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

          <div className="agent-header-spacer" />
          {workspacePath && (
            <div className="agent-header-workspace" title={workspacePath}>
              {workspacePath.split('/').pop()}
            </div>
          )}
        </div>
        <div className="agent-panel-body">
          <div className="agent-panel-content">
            <div className="agent-panel-messages">
            {activeSkillMeta && activeSkillMeta.status === 'running' && !skillDrawerHidden && (
              <div className="skill-status-bar">
                <div className="skill-status-icon"><div className="skill-status-spinner" /></div>
                <span className="skill-status-name">{activeSkillMeta.name}</span>
                <div className="skill-status-divider" />
                <span className="skill-status-phase">执行中<span className="skill-status-phase-dots"><span>.</span><span>.</span><span>.</span></span></span>
                <button className="skill-status-close" onClick={() => setSkillDrawerHidden(true)}>
                  <X size={14} />
                </button>
              </div>
            )}
            {children}
          </div>
        </div>
        </div>
        <div className="agent-panel-footer">
            {permissionRequest && (
              <PermissionDialog
                request={permissionRequest}
                onRespond={onPermissionRespond}
                queuePosition={1}
                queueTotal={1 + permissionQueueLength}
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
  )
}

export default AgentPanel
