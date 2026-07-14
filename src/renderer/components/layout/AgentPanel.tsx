import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, X } from 'lucide-react'
import type { PermissionRequestIPC as PermissionRequest, AskUserRequestIPC as AskUserRequest, SdkSessionInfo } from '../../../shared/types'
import type { AgentContext } from '../../../shared/types'
import { useAgentStore } from '../../store/agent-store-impl'
import PermissionDialog from '../chat/PermissionDialog'
import AskUserDrawer, { type AskUserTextSubmitHandler } from '../chat/AskUserDrawer'
import DrawerZone from './DrawerZone'
import TodoPanel from '../chat/TodoPanel'

interface AgentPanelProps {
  context?: AgentContext
  width: number
  workspacePath?: string
  permissionRequest: PermissionRequest | null
  permissionQueueLength: number
  onPermissionRespond: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => void
  askUserRequest: AskUserRequest | null
  onAskUserRespond: (requestId: string, answers: Record<string, string>) => void
  onAskUserTextSubmitReady?: (handler: AskUserTextSubmitHandler | null) => void
  sessionList: SdkSessionInfo[]
  currentSessionId: string | null
  activeSkillId: string | null
  children: React.ReactNode
  chatInput: React.ReactNode
  linkedFile: string | null
  onUnlinkFile: () => void
}

function AgentPanel({ context = 'editor', width, workspacePath, permissionRequest, permissionQueueLength, onPermissionRespond, askUserRequest, onAskUserRespond, onAskUserTextSubmitReady, sessionList, currentSessionId, activeSkillId, children, chatInput, linkedFile, onUnlinkFile }: AgentPanelProps): React.ReactElement {
  const [askDrawerOpen, setAskDrawerOpen] = useState(false)
  const [skillDrawerHidden, setSkillDrawerHidden] = useState(false)
  const [pendingAskAnswer, setPendingAskAnswer] = useState<{ requestId: string; answers: Record<string, string> } | null>(null)
  const todoList = useAgentStore((s) => s.slots[context].todoList)
  const dismissTodo = useAgentStore((s) => s.dismissTodo)

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

  const workspaceName = workspacePath?.split('/').pop() || ''
  const currentSessionTitle = sessionList.find((session) => session.id === currentSessionId)?.title?.trim() || '新会话'
  const sessionContextTitle = workspaceName
    ? `${workspaceName} / ${currentSessionTitle}`
    : currentSessionTitle

  return (
    <div className="agent-panel" style={{ width, minWidth: width, maxWidth: width }}>
      <div className="agent-panel-inner">
        <div className="agent-panel-header">
          <div className="agent-header-context" title={sessionContextTitle} aria-label={`当前会话：${sessionContextTitle}`}>
            <MessageSquare size={14} aria-hidden="true" />
            <span>{currentSessionTitle}</span>
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
                key={askUserRequest.id}
                request={askUserRequest}
                open={askDrawerOpen}
                onClose={() => setAskDrawerOpen(false)}
                onRespond={handleAskUserRespond}
                onTextSubmitReady={onAskUserTextSubmitReady}
              />
            )}
            <DrawerZone linkedFile={linkedFile} onUnlinkFile={onUnlinkFile} />
            {todoList && todoList.tasks.length > 0 && (
              <div style={{ padding: '0 8px 4px 8px' }}>
                <TodoPanel
                  todoList={todoList}
                  onClose={() => dismissTodo(context)}
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
