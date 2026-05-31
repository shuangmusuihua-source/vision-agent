import { useEffect, useRef, useState, useCallback } from 'react'
import { Monitor, FolderOpen, Trash2 } from 'lucide-react'
import { useAgent, useMessages, useIsStreaming, useIsResumingSession, useAgentStatus, usePermissionRequest, usePermissionQueueLength, useAskUserRequest } from '../../hooks/useAgent'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import PermissionDialog from '../chat/PermissionDialog'
import AskUserDrawer from '../chat/AskUserDrawer'
import { useAgentStore } from '../../store/agent-store-impl'
import bullLogo from '../../assets/zuovis-logo.svg'
import './ask-zuovis.css'

interface FeatureCard {
  id: string
  icon: React.ComponentType<{ size: number; className?: string }>
  title: string
  desc: string
  descBold: string[]
  colorClass: string
  prompt: string
  skillId?: string
}

const FEATURES: FeatureCard[] = [
  { id: 'organize-desktop', icon: Monitor, title: '整理桌面', desc: '分析你的桌面文件，给出智能整理方案', descBold: ['桌面文件', '整理方案'], colorClass: 'ask-card-purple', prompt: '整理我的桌面', skillId: 'organize-desktop' },
  { id: 'organize-files', icon: FolderOpen, title: '整理文件', desc: '选择一个文件夹，我来帮你归类整理', descBold: ['归类整理'], colorClass: 'ask-card-pink', prompt: '整理我的文件夹', skillId: 'organize-folder' },
  { id: 'system-cleanup', icon: Trash2, title: '系统清理', desc: '扫描垃圾文件，释放宝贵的磁盘空间', descBold: ['垃圾文件', '磁盘空间'], colorClass: 'ask-card-blue', prompt: '扫描并清理我的系统垃圾', skillId: 'system-cleanup' },
]

interface AskZuovisProps {
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
}

function AskZuovis({ onOpenFile, onSelectText, workspacePath }: AskZuovisProps): React.ReactElement {
  const { sendMessage, respondPermission, respondAskUser } = useAgent('ask')
  const messages = useMessages('ask')
  const isStreaming = useIsStreaming('ask')
  const agentStatus = useAgentStatus('ask')
  const isResuming = useIsResumingSession()
  const permissionRequest = usePermissionRequest('ask')
  const permissionQueueLen = usePermissionQueueLength('ask')
  const askUserRequest = useAskUserRequest('ask')
  const hasMessages = messages.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── AskUser interaction ──
  const [askDrawerOpen, setAskDrawerOpen] = useState(false)
  const [pendingAskAnswer, setPendingAskAnswer] = useState<{ requestId: string; answer: string } | null>(null)
  const askDrawerRespondRef = useRef<((answer: string) => void) | null>(null)

  useEffect(() => {
    if (askUserRequest) setAskDrawerOpen(true)
  }, [askUserRequest])

  useEffect(() => {
    if (pendingAskAnswer && !askDrawerOpen) {
      respondAskUser(pendingAskAnswer.requestId, pendingAskAnswer.answer)
      setPendingAskAnswer(null)
    }
  }, [pendingAskAnswer, askDrawerOpen, respondAskUser])

  const handlePermissionRespond = useCallback((requestId: string, behavior: 'allow' | 'deny') => {
    respondPermission(requestId, behavior)
  }, [respondPermission])

  const handleAskUserRespond = useCallback((answer: string) => {
    if (!askUserRequest) return
    setPendingAskAnswer({ requestId: askUserRequest.id, answer })
    setAskDrawerOpen(false)
  }, [askUserRequest])

  useEffect(() => {
    askDrawerRespondRef.current = handleAskUserRespond
  }, [handleAskUserRespond])

  const handleCardClick = async (card: FeatureCard) => {
    if (isStreaming && agentStatus !== 'waitingForUserInput') return
    if (card.id === 'organize-files') {
      const result = await window.api.agent.selectFolder()
      if (result.canceled || !result.filePaths.length) return
      if (card.skillId) {
        useAgentStore.setState((prev) => ({
          slots: {
            ...prev.slots,
            ask: { ...prev.slots.ask, activeSkillId: card.skillId ?? null },
          },
        }))
      }
      sendMessage(`整理这个文件夹：${result.filePaths[0]}`)
      return
    }
    if (card.skillId) {
      useAgentStore.setState((prev) => ({
        slots: {
          ...prev.slots,
          ask: { ...prev.slots.ask, activeSkillId: card.skillId ?? null },
        },
      }))
    }
    sendMessage(card.prompt)
  }

  const handleChatSend = useCallback((msg: string) => {
    if (askUserRequest && askDrawerRespondRef.current) {
      askDrawerRespondRef.current(msg)
    } else {
      sendMessage(msg)
    }
  }, [askUserRequest, sendMessage])

  return (
    <div className="ask-zuovis">
      <div className="ask-zuovis-scroll" ref={scrollRef}>
        {isResuming && (
          <div className="ask-zuovis-resuming">
            <span className="spin" style={{ display: 'inline-block' }}>⏳</span> 加载会话历史…
          </div>
        )}

        {!hasMessages ? (
          <div className="ask-zuovis-content">
            <div className="ask-zuovis-greeting">
              <img className="ask-zuovis-greeting-logo" src={bullLogo} alt="Zuovis" />
              <div className="ask-zuovis-greeting-text">
                <div className="ask-zuovis-greeting-title">你好，有什么可以帮你？</div>
                <div className="ask-zuovis-greeting-sub">我是 Zuovis，你的智能助手</div>
              </div>
            </div>

            <div className="ask-zuovis-grid">
              {FEATURES.map((feature) => {
                const Icon = feature.icon
                return (
                  <button
                    key={feature.id}
                    className={`ask-zuovis-card ${feature.colorClass}`}
                    onClick={() => handleCardClick(feature)}
                  >
                    <span className="ask-zuovis-card-title">
                      <Icon size={16} />
                      {feature.title}
                    </span>
                    <div className="ask-zuovis-card-glass">
                      <span className="ask-zuovis-card-desc">
                        {feature.descBold
                          ? feature.desc.split(new RegExp(`(${feature.descBold.join('|')})`, 'g')).map((part, i) =>
                              feature.descBold.includes(part)
                                ? <strong key={i}>{part}</strong>
                                : part
                            )
                          : feature.desc
                        }
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="ask-zuovis-messages-inner">
            <ChatView context="ask" onOpenFile={onOpenFile} onSelectText={onSelectText} workspacePath={workspacePath} />
          </div>
        )}
      </div>

      <div className="ask-zuovis-footer">
        {permissionRequest && (
          <PermissionDialog
            request={permissionRequest}
            onRespond={handlePermissionRespond}
            queuePosition={1}
            queueTotal={1 + permissionQueueLen}
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
          <ChatInput
          context="ask"
          onSend={handleChatSend}
          onStop={() => window.api.agent.abort('ask')}
          disabled={(isStreaming && agentStatus !== 'waitingForUserInput') && !askUserRequest}
          isStreaming={isStreaming}
          placeholder={agentStatus === 'waitingForUserInput' ? '回答 Agent 的问题...' : undefined}
          variant="capsule"
        />
      </div>
    </div>
  )
}

export default AskZuovis