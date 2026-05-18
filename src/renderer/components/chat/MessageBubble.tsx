import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, AskUserRequest } from '../../store/agent-store'

interface MessageBubbleProps {
  message: ChatMessage
  askUserRequest: AskUserRequest | null
  onRespondAskUser: (requestId: string, answer: string) => void
}

function MessageBubble({ message, askUserRequest, onRespondAskUser }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}${isSystem ? ' message-system' : ''}`}>
      <div className="message-content">
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
      {askUserRequest && askUserRequest.options && askUserRequest.options.length > 0 && (
        <div className="ask-user-options">
          {askUserRequest.options.map((opt, i) => (
            <button
              key={i}
              className="ask-user-option-btn"
              onClick={() => onRespondAskUser(askUserRequest.id, opt.label)}
              title={opt.description}
            >
              <span className="ask-user-option-label">{opt.label}</span>
              {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageBubble