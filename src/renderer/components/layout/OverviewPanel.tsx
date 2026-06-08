import { FileText, Box, RefreshCw, Loader2 } from 'lucide-react'
import { useAgentStore } from '../../store/agent-store-impl'
import type { SessionOutputEntry } from '../../../shared/types'

interface OverviewPanelProps {
  sessionId: string | null
  onOpenFile: (path: string) => void
}

function OverviewPanel({ sessionId, onOpenFile }: OverviewPanelProps): React.ReactElement {
  const sessionOutputs = useAgentStore((s) => s.sessionOutputs)
  const loading = useAgentStore((s) => s.sessionOutputsLoading)

  // Loading
  if (loading) {
    return (
      <div className="overview-panel">
        <div className="overview-loading">
          <Loader2 size={24} className="overview-spinner-icon" />
          <span>加载会话文件...</span>
        </div>
      </div>
    )
  }

  // No session selected
  if (!sessionId) {
    return (
      <div className="overview-panel">
        <div className="overview-empty">
          <div className="overview-empty-icon"><FileText size={48} /></div>
          <h3>未选择会话</h3>
          <p>请从侧边栏选择一个会话，查看其产出的文件和产物</p>
        </div>
      </div>
    )
  }

  // No outputs (or stale outputs from a different session)
  if (!sessionOutputs || sessionOutputs.sessionId !== sessionId || sessionOutputs.files.length === 0) {
    return (
      <div className="overview-panel">
        <div className="overview-header">
          <h2 className="overview-title">会话文件</h2>
        </div>
        <div className="overview-empty">
          <div className="overview-empty-icon"><FileText size={36} /></div>
          <h3>当前会话尚未产生文件</h3>
          <p>与 Agent 开始对话后，生成的文档和产物会显示在这里</p>
        </div>
      </div>
    )
  }

  const documents = sessionOutputs.files.filter(f => f.category === 'document')
  const skillOutputs = sessionOutputs.files.filter(f => f.category === 'skill_output')
  const others = sessionOutputs.files.filter(f => f.category === 'other')

  const renderFileList = (files: SessionOutputEntry[]) => (
    <div className="overview-file-list">
      {files.map((f) => (
        <button
          key={f.filePath}
          className="overview-file-chip"
          onClick={() => onOpenFile(f.filePath)}
          title={f.filePath}
        >
          <FileText size={14} />
          <span className="overview-file-chip-name">{f.fileName}</span>
          <span className="overview-file-chip-source">{f.source}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="overview-panel">
      <div className="overview-header">
        <h2 className="overview-title">会话文件</h2>
        <span className="overview-file-count">{sessionOutputs.files.length} 个文件</span>
      </div>

      {documents.length > 0 && (
        <div className="overview-section">
          <h3 className="overview-section-title">md 文档</h3>
          {renderFileList(documents)}
        </div>
      )}

      {skillOutputs.length > 0 && (
        <div className="overview-section">
          <h3 className="overview-section-title">
            <Box size={14} /> Skill 产物
          </h3>
          {renderFileList(skillOutputs)}
        </div>
      )}

      {others.length > 0 && (
        <div className="overview-section">
          <h3 className="overview-section-title">其他文件</h3>
          {renderFileList(others)}
        </div>
      )}
    </div>
  )
}

export default OverviewPanel
