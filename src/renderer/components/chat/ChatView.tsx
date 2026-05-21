import { useEffect, useRef, useMemo } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
import type { ChatMessage } from '../../store/agent-store'
import { useMessages } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
}

function ChatView({ onOpenFile, onSelectText }: ChatViewProps): React.ReactElement {
  const messages = useMessages()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const skillToolCallsMap = useMemo(() => {
    const map = new Map<string, ChatMessage[]>()
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].skillInfo && messages[i].role === 'user') {
        const following: ChatMessage[] = []
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'assistant' && messages[j].skillInfo) {
            following.push(messages[j])
          } else if (messages[j].role === 'user') {
            break
          }
        }
        map.set(messages[i].id, following)
      }
    }
    return map
  }, [messages])

  return (
    <div className="chat-view">
      {messages.length === 0 && (
        <div className="chat-empty">
          <ChatCircleDots size={48} weight="thin" className="chat-empty-icon" />
          <span className="chat-empty-hint">开始对话</span>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          skillFollowingMessages={skillToolCallsMap.get(msg.id)}
          onOpenFile={onOpenFile}
          onSelectText={onSelectText}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView
