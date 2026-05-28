import { useEffect, useRef } from 'react'
import {
  BookOpen, Code, ChartBar, Globe, Lightbulb, PencilSimple,
  Sparkle, ArrowsLeftRight, Database, GearSix, ChatCircleDots
} from '@phosphor-icons/react'
import { useMessages } from '../../hooks/useAgent'
import ChatView from '../chat/ChatView'
import ChatInput from '../chat/ChatInput'
import './ask-zuovis.css'

interface AskZuovisProps {
  onSend: (message: string) => void
  disabled?: boolean
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string, context?: string) => void
  workspacePath?: string
}

const QUICK_CARDS = [
  { icon: Code, label: '编写代码', prompt: '帮我编写以下代码：' },
  { icon: PencilSimple, label: '编辑优化', prompt: '帮我编辑优化以下内容：' },
  { icon: ChartBar, label: '数据分析', prompt: '帮我分析以下数据：' },
  { icon: Lightbulb, label: '创意灵感', prompt: '给我一些关于以下主题的创意灵感：' },
  { icon: BookOpen, label: '解释概念', prompt: '请帮我解释以下概念：' },
  { icon: Globe, label: '翻译润色', prompt: '帮我翻译润色以下文本：' },
  { icon: ArrowsLeftRight, label: '对比分析', prompt: '帮我对比分析以下内容：' },
  { icon: Database, label: '生成方案', prompt: '帮我生成以下方面的方案：' },
]

function AskZuovis({ onSend, disabled, onOpenFile, onSelectText, workspacePath }: AskZuovisProps): React.ReactElement {
  const messages = useMessages('ask')
  const hasMessages = messages.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="ask-zuovis">
      <div className="ask-zuovis-scroll" ref={scrollRef}>
        {!hasMessages ? (
          <AskWelcome onCardClick={onSend} disabled={disabled} />
        ) : (
          <ChatView context="ask" onOpenFile={onOpenFile} onSelectText={onSelectText} workspacePath={workspacePath} />
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

/* ── 空状态欢迎页 ── */

interface AskWelcomeProps {
  onCardClick: (prompt: string) => void
  disabled?: boolean
}

function AskWelcome({ onCardClick, disabled }: AskWelcomeProps): React.ReactElement {
  return (
    <div className="ask-welcome">
      <div className="ask-welcome-header">
        <Sparkle size={28} weight="duotone" />
        <h2>Zuovis</h2>
        <p>你的 AI 助手，随时提问</p>
      </div>
      <div className="ask-welcome-cards">
        {QUICK_CARDS.map((card) => (
          <button
            key={card.label}
            className="ask-welcome-card"
            onClick={() => onCardClick(card.prompt)}
            disabled={disabled}
            type="button"
          >
            <card.icon size={20} weight="duotone" />
            <span>{card.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default AskZuovis