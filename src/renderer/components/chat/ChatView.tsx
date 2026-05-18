import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../store/agent-store'
import type { AskUserRequest } from '../../lib/ipc'
import MessageBubble from './MessageBubble'

interface ChatViewProps {
  messages: ChatMessage[]
  askUserRequest: AskUserRequest | null
  onRespondAskUser: (requestId: string, answer: string) => void
  onOpenFile?: (path: string) => void
}

function ChatView({ messages, askUserRequest, onRespondAskUser, onOpenFile }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Collect toolCalls from assistant messages that follow a skill trigger message
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
          <span className="chat-empty-hint">开始对话</span>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          askUserRequest={msg.id === askUserRequest?.id ? askUserRequest : null}
          onRespondAskUser={onRespondAskUser}
          skillFollowingMessages={skillToolCallsMap.get(msg.id)}
          onOpenFile={onOpenFile}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView