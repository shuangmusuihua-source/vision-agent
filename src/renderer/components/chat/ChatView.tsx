import { useEffect, useRef } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
import type { ChatMessage } from '../../store/agent-store'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  messages: ChatMessage[]
  onOpenFile?: (path: string) => void
}

function ChatView({ messages, onOpenFile }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const skillToolCallsMap = new Map<string, ChatMessage[]>()
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
      skillToolCallsMap.set(messages[i].id, following)
    }
  }

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
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView