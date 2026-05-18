import { useEffect, useRef } from 'react'
import type { ChatMessage, AskUserRequest } from '../../store/agent-store'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  messages: ChatMessage[]
  askUserRequest: AskUserRequest | null
  onRespondAskUser: (requestId: string, answer: string) => void
}

function ChatView({ messages, askUserRequest, onRespondAskUser }: ChatViewProps): React.ReactElement {
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
        <MessageBubble
          key={msg.id}
          message={msg}
          askUserRequest={msg.id === askUserRequest?.id ? askUserRequest : null}
          onRespondAskUser={onRespondAskUser}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView