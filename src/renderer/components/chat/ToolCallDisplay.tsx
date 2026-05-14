import { useState } from 'react'
import { ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import type { ToolCall } from '../../store/agent-store'

interface ToolCallDisplayProps {
  toolCall: ToolCall
}

function ToolCallDisplay({ toolCall }: ToolCallDisplayProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)

  const inputSummary = (() => {
    const input = toolCall.input
    if (input.file_path) return String(input.file_path).split('/').pop()
    if (input.path) return String(input.path).split('/').pop()
    if (input.command) return String(input.command).slice(0, 40)
    if (input.query) return String(input.query).slice(0, 40)
    return ''
  })()

  const statusIcon = toolCall.status === 'running' ? '⏳' : toolCall.status === 'error' ? '✕' : '✓'
  const statusClass = `tool-call-status tool-call-status-${toolCall.status}`

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} />
        <span className="tool-call-name">{toolCall.toolName}</span>
        {inputSummary && <span className="tool-call-summary">{inputSummary}</span>}
        <span className={statusClass}>{statusIcon}</span>
      </div>
      {expanded && (
        <div className="tool-call-detail">
          <div className="tool-call-section">
            <span className="tool-call-label">Input:</span>
            <pre className="tool-call-pre">{JSON.stringify(toolCall.input, null, 2)}</pre>
          </div>
          {toolCall.result && (
            <div className="tool-call-section">
              <span className="tool-call-label">Result:</span>
              <pre className="tool-call-pre">{toolCall.result.slice(0, 500)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolCallDisplay