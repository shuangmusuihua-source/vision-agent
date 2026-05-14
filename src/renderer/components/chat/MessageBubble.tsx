import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../store/agent-store'
import ToolCallDisplay from './ToolCallDisplay'

interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}`}>
      {isUser ? (
        <div className="message-user-content">{message.content}</div>
      ) : (
        <div className="message-assistant-content">
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message-tool-calls">
              {message.toolCalls.map((tc, i) => (
                <ToolCallDisplay key={`${tc.toolName}-${i}`} toolCall={tc} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
          {message.isStreaming && !message.content && (
            <span className="message-streaming-dots">· · ·</span>
          )}
        </div>
      )}
    </div>
  )
}

export default MessageBubble