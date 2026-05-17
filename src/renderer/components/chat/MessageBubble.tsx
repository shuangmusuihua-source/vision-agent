import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../store/agent-store'
import ToolCallDisplay from './ToolCallDisplay'

interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'

  if (message.isStatusIndicator) {
    return (
      <div className="message-bubble message-assistant">
        <div className="message-status-indicator">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}`}>
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <span className="message-streaming-dots">· · ·</span>
          )}
        </div>
      )}
    </div>
  )
}

export default MessageBubble