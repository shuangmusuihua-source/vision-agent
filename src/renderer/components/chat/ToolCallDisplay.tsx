import { ChevronDown, ChevronRight, Check, Loader2, FileText, FilePenLine, Terminal, Search, FolderSearch, Globe, MessageCircle, Sparkles, Wrench } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { ToolCall } from '../../store/agent-store'

interface ToolCallDisplayProps {
  toolCall: ToolCall
}

const TOOL_META: Record<string, { icon: ReactElement; label: string }> = {
  Read:       { icon: <FileText size={13} />,       label: '读取' },
  Write:      { icon: <Sparkles size={13} />,       label: '生成' },
  Edit:       { icon: <FilePenLine size={13} />,    label: '编辑' },
  Bash:       { icon: <Terminal size={13} />,       label: '执行命令' },
  Grep:       { icon: <Search size={13} />,         label: '搜索内容' },
  Glob:       { icon: <FolderSearch size={13} />,   label: '查找文件' },
  WebSearch:  { icon: <Search size={13} />,          label: '搜索' },
  WebFetch:   { icon: <Globe size={13} />,          label: '浏览网页' },
  AskUserQuestion: { icon: <MessageCircle size={13} />, label: '询问' },
}

const FALLBACK_META = { icon: <Wrench size={13} />, label: '' }

function friendlySummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const p = String(input.file_path || '')
      const name = p.split('/').pop() || p
      return name
    }
    case 'Bash':
      return ''
    case 'Grep':
      return String(input.pattern || '')
    case 'Glob':
      return String(input.pattern || '')
    case 'WebSearch':
      return String(input.query || '')
    case 'WebFetch':
      return String(input.url || '')
    default:
      return ''
  }
}

function detailText(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Bash':
      return String(input.command || '')
    case 'Write':
    case 'Edit':
      return null // file content is projected by GenerationActivityCard
    default:
      const vals = Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      return vals.length > 0 ? vals.join('\n') : null
  }
}

function ToolCallDisplay({ toolCall }: ToolCallDisplayProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const meta = TOOL_META[toolCall.toolName] || { ...FALLBACK_META, label: toolCall.toolName }
  const summary = friendlySummary(toolCall.toolName, toolCall.input)
  const detail = expanded ? detailText(toolCall.toolName, toolCall.input) : null
  const isDone = toolCall.status === 'completed' || toolCall.status === 'error'
  const hasDetail = detailText(toolCall.toolName, toolCall.input) !== null

  return (
    <div className={`tc-bar${isDone ? ' tc-bar-done' : ''}`}>
      <div className="tc-bar-main" onClick={() => hasDetail && setExpanded(!expanded)}>
        {hasDetail ? (
          <span className="tc-chevron">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        ) : (
          <span className="tc-chevron tc-chevron-invis" />
        )}
        <span className="tc-icon">{meta.icon}</span>
        <span className="tc-label">{meta.label}</span>
        {summary && <span className="tc-summary">{summary}</span>}
        <span className="tc-status">
          {toolCall.status === 'running' || toolCall.status === 'pending' ? (
            <span className="tc-spinner"><Loader2 size={11} /></span>
          ) : toolCall.status === 'completed' ? (
            <Check size={12} className="tc-check" />
          ) : null}
        </span>
      </div>
      {expanded && detail && (
        <pre className="tc-detail">{detail}</pre>
      )}
    </div>
  )
}

export default ToolCallDisplay
