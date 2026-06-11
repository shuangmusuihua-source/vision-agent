import { useState, useEffect, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import type { UsageInfo, PermissionRequestIPC as PermissionRequest, AskUserRequestIPC as AskUserRequest, SdkSessionInfo } from '../../../shared/types'
import type { AgentContext } from '../../../shared/types'
import type { SkillMeta } from '../../../shared/types'
import { useAgentStore } from '../../store/agent-store-impl'
import PermissionDialog from '../chat/PermissionDialog'
import AskUserDrawer from '../chat/AskUserDrawer'
import DrawerZone from './DrawerZone'
import TodoPanel from '../chat/TodoPanel'

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
  const [askDrawerOpen, setAskDrawerOpen] = useState(false)
  const [skillDrawerHidden, setSkillDrawerHidden] = useState(false)
  const [pendingAskAnswer, setPendingAskAnswer] = useState<{ requestId: string; answers: Record<string, string> } | null>(null)
  const todoList = useAgentStore((s) => s.slots[context].todoList)

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

  return (
    <div className={`agent-panel ${edgeClass}`} style={{ width, minWidth: width, maxWidth: width }}>
      <div className="agent-panel-inner">
        <div className="agent-panel-header">
          <div className="agent-header-workspace" title={workspacePath || undefined}>
            {workspacePath ? workspacePath.split('/').pop() : ''}
            {currentSessionId && sessionList.find(s => s.id === currentSessionId)?.title && (
              <>｜{sessionList.find(s => s.id === currentSessionId)!.title}</>
            )}
          </div>
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
            {todoList && todoList.tasks.length > 0 && (
              <div style={{ padding: '0 8px 4px 8px' }}>
                <TodoPanel
                  todoList={todoList}
                  onClose={() => {
                    useAgentStore.setState((s) => ({
                      slots: { ...s.slots, [context]: { ...s.slots[context], todoList: null } },
                    }))
                  }}
                />
              </div>
            )}
            {chatInput}
        </div>
      </div>
    </div>
  )
}

export default AgentPanel
