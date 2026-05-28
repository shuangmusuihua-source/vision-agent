import { useEffect, useRef } from 'react'
import { Monitor, FolderOpen, FileText, PresentationChart, MagnifyingGlass, ChartBar } from '@phosphor-icons/react'
import { useMessages, useIsStreaming, useIsResumingSession, useAgentStatus } from '../../hooks/useAgent'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import type { AgentContext } from '../../../shared/types'
import './ask-zuovis.css'

interface FeatureCard {
  icon: React.ComponentType<{ size: number; weight: string; className?: string }>
  title: string
  desc: string
  colorClass: string
  prompt: string
}

const FEATURES: FeatureCard[] = [
  { icon: Monitor, title: '管理电脑', desc: '整理桌面、清理文件、管理应用', colorClass: 'ask-card-purple', prompt: '帮我管理电脑' },
  { icon: FolderOpen, title: '整理文件', desc: '分类归档、批量重命名、去重', colorClass: 'ask-card-pink', prompt: '帮我整理文件' },
  { icon: FileText, title: '写文档', desc: '简历、报告、方案、会议纪要', colorClass: 'ask-card-blue', prompt: '帮我写文档' },
  { icon: PresentationChart, title: '做 PPT', desc: '演示文稿、产品展示、培训课件', colorClass: 'ask-card-green', prompt: '帮我做PPT' },
  { icon: MagnifyingGlass, title: '搜索知识', desc: '知识库检索、信息整理、摘要', colorClass: 'ask-card-orange', prompt: '帮我搜索知识' },
  { icon: ChartBar, title: '分析数据', desc: '数据解读、趋势分析、可视化', colorClass: 'ask-card-teal', prompt: '帮我分析数据' },
]

interface AskZuovisProps {
  onSend: (message: string) => void
  disabled?: boolean
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
}

function AskZuovis({ onSend, disabled, onOpenFile, onSelectText, workspacePath }: AskZuovisProps): React.ReactElement {
  const messages = useMessages('ask')
  const isStreaming = useIsStreaming('ask')
  const isResuming = useIsResumingSession()
  const agentState = useAgentStatus('ask')
  const hasMessages = messages.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleCardClick = (prompt: string) => {
    if (!disabled) onSend(prompt)
  }

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
              <div className="ask-zuovis-greeting-title">你好，有什么可以帮你？</div>
              <div className="ask-zuovis-greeting-sub">我是 Zuovis，你的智能助手</div>
            </div>

            <div className="ask-zuovis-grid">
              {FEATURES.map((feature) => {
                const Icon = feature.icon
                return (
                  <button
                    key={feature.title}
                    className={`ask-zuovis-card ${feature.colorClass}`}
                    onClick={() => handleCardClick(feature.prompt)}
                  >
                    <div className="ask-zuovis-card-icon">
                      <Icon size={16} weight="regular" />
                    </div>
                    <div className="ask-zuovis-card-title">{feature.title}</div>
                    <div className="ask-zuovis-card-desc">{feature.desc}</div>
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
        <ChatInput
          context="ask"
          onSend={onSend}
          disabled={!!disabled}
          variant="capsule"
        />
      </div>
    </div>
  )
}

export default AskZuovis