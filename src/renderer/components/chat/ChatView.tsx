import { useEffect, useRef, useMemo } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
import { useMessages, useIsStreaming } from '../../hooks/useAgent'
import MessageBubble from './MessageBubble'
import type { ConversationMessage } from '../../../shared/types'

interface ChatViewProps {
  onOpenFile?: (path: string) => void
  onSelectText?: (text: string) => void
  workspacePath?: string
}

function ChatView({ onOpenFile, onSelectText, workspacePath }: ChatViewProps): React.ReactElement {
  const messages = useMessages()
  const isStreaming = useIsStreaming()
  const bottomRef = useRef<HTMLDivElement>(null)

  const prevMsgCount = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMsgCount.current = messages.length
  }, [messages.length])

  return (
    <div className="chat-view" aria-live="polite" aria-label="对话消息">
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
          onOpenFile={onOpenFile}
          onSelectText={onSelectText}
          workspacePath={workspacePath}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

export default ChatView