import { CaretDown, CaretRight, Wrench, Check, X, Spinner } from '@phosphor-icons/react'
import { useState } from 'react'
import type { ToolCall } from '../../store/agent-store'

interface ToolCallDisplayProps {
  toolCall: ToolCall
}

function ToolCallDisplay({ toolCall }: ToolCallDisplayProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = {
    running: <Spinner size={12} weight="bold" className="tool-call-spinner" />,
    completed: <Check size={12} weight="bold" className="tool-call-success" />,
    error: <X size={12} weight="bold" className="tool-call-error" />
  }[toolCall.status]

  const inputSummary = summarizeInput(toolCall.toolName, toolCall.input)
  const resultPreview = toolCall.result
    ? toolCall.result.length > 200
      ? toolCall.result.slice(0, 200) + '...'
      : toolCall.result
    : null

  return (
    <div className="tool-call-display">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-chevron">
          {expanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
        </span>
        <Wrench size={12} weight="bold" className="tool-call-icon" />
        <span className="tool-call-name">{toolCall.toolName}</span>
        <span className="tool-call-summary">{inputSummary}</span>
        <span className="tool-call-status">{statusIcon}</span>
      </div>
      {expanded && (
        <div className="tool-call-details">
          <div className="tool-call-input">
            <div className="tool-call-label">Input</div>
            <pre>{JSON.stringify(toolCall.input, null, 2)}</pre>
          </div>
          {resultPreview && (
            <div className="tool-call-result">
              <div className="tool-call-label">Result</div>
              <pre>{resultPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return String(input.file_path || '').split('/').pop() || ''
    case 'Write':
      return String(input.file_path || '').split('/').pop() || ''
    case 'Edit':
      return String(input.file_path || '').split('/').pop() || ''
    case 'Bash':
      const cmd = String(input.command || '')
      return cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd
    case 'Grep':
      return String(input.pattern || '')
    case 'Glob':
      return String(input.pattern || '')
    case 'WebSearch':
      return String(input.query || '')
    case 'WebFetch':
      return String(input.url || '')
    default:
      const vals = Object.values(input)
      if (vals.length > 0) {
        const s = String(vals[0])
        return s.length > 30 ? s.slice(0, 30) + '...' : s
      }
      return ''
  }
}

export default ToolCallDisplay