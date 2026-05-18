import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../store/agent-store'
import type { AskUserRequest } from '../../lib/ipc'
import ToolCallDisplay from './ToolCallDisplay'

const REMARK_PLUGINS = [remarkGfm]

interface MessageBubbleProps {
  message: ChatMessage
  askUserRequest: AskUserRequest | null
  onRespondAskUser: (requestId: string, answer: string) => void
}

function MessageBubble({ message, askUserRequest, onRespondAskUser }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const [answered, setAnswered] = useState(false)

  if (message.isStatusIndicator) {
    return (
      <div className="message-bubble message-assistant">
        <div className="message-status-indicator">
          {message.content}
        </div>
      </div>
    )
  }

  const handleAnswer = (requestId: string, answer: string) => {
    if (answered) return
    setAnswered(true)
    onRespondAskUser(requestId, answer)
  }

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}${isSystem ? ' message-system' : ''}`}>
      {isUser ? (
        <div className="message-user-content">{message.content}</div>
      ) : (
        <div className="message-assistant-content">
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message-tool-calls">
              {message.toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolUseId} toolCall={tc} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{message.content}</ReactMarkdown>
            </div>
          )}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <span className="message-streaming-dots">· · ·</span>
          )}
          {askUserRequest && askUserRequest.options && askUserRequest.options.length > 0 && (
            <div className="ask-user-options">
              {askUserRequest.options.map((opt, i) => (
                <button
                  key={i}
                  className="ask-user-option-btn"
                  onClick={() => handleAnswer(askUserRequest.id, opt.label)}
                  disabled={answered}
                  title={opt.description}
                >
                  <span className="ask-user-option-label">{opt.label}</span>
                  {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MessageBubble