import { useState } from 'react'
import { CaretDown, CaretRight, Spinner, Check, X, FileText, FileHtml } from '@phosphor-icons/react'
import type { SkillInfo, ToolCall } from '../../store/agent-store'

interface SkillCardProps {
  skillInfo: SkillInfo
  toolCalls?: ToolCall[]
  onOpenFile?: (path: string) => void
}

function SkillCard({ skillInfo, toolCalls, onOpenFile }: SkillCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const isRunning = skillInfo.status === 'running'
  const isCompleted = skillInfo.status === 'completed'
  const isError = skillInfo.status === 'error'

  const completedCount = toolCalls?.filter((tc) => tc.status === 'completed').length || 0
  const totalCount = toolCalls?.length || 0

  const handleOutputClick = () => {
    if (skillInfo.outputFile && onOpenFile) {
      const ext = skillInfo.outputFile.split('.').pop()?.toLowerCase()
      if (ext === 'html' || ext === 'htm') {
        window.api.workspace.openInBrowser(skillInfo.outputFile)
      } else {
        onOpenFile(skillInfo.outputFile)
      }
    }
  }

  const outputExt = skillInfo.outputFile?.split('.').pop()?.toLowerCase()
  const OutputIcon = outputExt === 'html' || outputExt === 'htm' ? FileHtml : FileText

  return (
    <div className={`skill-card skill-card-${skillInfo.status}`}>
      <div className="skill-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="skill-card-chevron">
          {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        </span>
        <span className="skill-card-name">{skillInfo.name}</span>
        <span className="skill-card-status">
          {isRunning && <Spinner size={14} className="skill-card-spinner" />}
          {isCompleted && <Check size={14} className="skill-card-check" />}
          {isError && <X size={14} className="skill-card-error-icon" />}
        </span>
        {isRunning && totalCount > 0 && (
          <span className="skill-card-progress">{completedCount}/{totalCount}</span>
        )}
      </div>
      {expanded && toolCalls && toolCalls.length > 0 && (
        <div className="skill-card-steps">
          {toolCalls.map((tc) => (
            <div key={tc.toolUseId} className={`skill-card-step skill-card-step-${tc.status}`}>
              {tc.status === 'running' && <Spinner size={12} className="skill-card-spinner" />}
              {tc.status === 'completed' && <Check size={12} className="skill-card-step-completed" />}
              {tc.status === 'error' && <X size={12} className="skill-card-step-error" />}
              <span className="skill-card-step-name">{tc.toolName}</span>
            </div>
          ))}
        </div>
      )}
      {isCompleted && skillInfo.outputFile && (
        <div className="skill-card-output" onClick={handleOutputClick}>
          <OutputIcon size={14} weight="regular" />
          <span className="skill-card-output-name">
            {skillInfo.outputFile.split('/').pop()}
          </span>
          <span className="skill-card-output-action">
            {outputExt === 'html' || outputExt === 'htm' ? '在浏览器中打开' : '在编辑器中打开'}
          </span>
        </div>
      )}
    </div>
  )
}

export default SkillCard
