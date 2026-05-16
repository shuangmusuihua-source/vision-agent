import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../store/agent-store'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  messages: ChatMessage[]
}

function ChatView({ messages }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="chat-view">
      {messages.length === 0 && (
        <div className="chat-empty">
          <span className="chat-empty-hint">开始对话</span>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView