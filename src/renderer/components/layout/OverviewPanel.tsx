import { FileText, Box, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { useAgentStore } from '../../store/agent-store-impl'
import type { SessionOutputEntry } from '../../../shared/types'

interface OverviewPanelProps {
  sessionId: string | null
  activeFilePath?: string
  onOpenFile: (path: string) => void
}

type OverviewFileIcon = LucideIcon | ((props: { size?: number; strokeWidth?: number }) => React.ReactElement)

function OverviewPanel({ sessionId, activeFilePath, onOpenFile }: OverviewPanelProps): React.ReactElement {
  const sessionOutputs = useAgentStore((s) => s.sessionOutputs)

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

  function SlidesIcon({ size = 20 }: { size?: number; strokeWidth?: number }): React.ReactElement {
    return (
      <svg className="overview-slides-icon" width={size} height={size} viewBox="0 0 42 42" fill="none" aria-hidden="true">
        <path className="overview-slides-icon-line" d="M8 8.5h26" />
        <rect className="overview-slides-icon-screen" x="10.5" y="11.5" width="21" height="18" rx="1.5" />
        <rect className="overview-slides-icon-accent" x="16.5" y="17" width="9" height="6" rx="0.5" />
        <path className="overview-slides-icon-line" d="M21 29.5v5" />
        <path className="overview-slides-icon-line" d="m15.5 37 5.5-5.5L26.5 37" />
      </svg>
    )
  }

  const getFileMeta = (fileName: string, variant: 'md' | 'skill'): {
    badge: string
    icon: OverviewFileIcon
    kind: 'slides' | 'md' | 'file'
  } => {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    const isHtmlSlides = ext === 'html' || ext === 'htm'
    const isMarkdown = ext === 'md' || variant === 'md'

    return {
      badge: isHtmlSlides ? 'HTML' : isMarkdown ? 'MD' : ext.toUpperCase() || 'FILE',
      icon: isHtmlSlides ? SlidesIcon : FileText,
      kind: isHtmlSlides ? 'slides' : isMarkdown ? 'md' : 'file',
    }
  }

  const renderFileList = (files: SessionOutputEntry[], variant: 'md' | 'skill' = 'md') => (
    <div className={`overview-file-list overview-file-list--${variant}`}>
      {files.map((f) => {
        const meta = getFileMeta(f.fileName, variant)
        const FileIcon = meta.icon
        const isActive = activeFilePath === f.filePath

        return (
          <button
            key={f.filePath}
            className={`overview-file-chip overview-file-chip--${variant} overview-file-chip--${meta.kind}${isActive ? ' overview-file-chip--active' : ''}`}
            onClick={() => onOpenFile(f.filePath)}
            title={f.filePath}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="overview-file-chip-icon" aria-hidden="true">
              <FileIcon size={20} strokeWidth={1.9} />
            </span>
            <span className="overview-file-chip-content">
              <span className="overview-file-chip-name">{f.fileName}</span>
              <span className={`overview-file-chip-badge overview-file-chip-badge--${meta.kind}`}>{meta.badge}</span>
            </span>
            <ArrowUpRight size={12} className="overview-file-chip-arrow" aria-hidden="true" />
          </button>
        )
      })}
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
          <h3 className="overview-section-title">MD 文档</h3>
          {renderFileList(documents, 'md')}
        </div>
      )}

      {skillOutputs.length > 0 && (
        <div className="overview-section">
          <h3 className="overview-section-title">
            <Box size={14} strokeWidth={2} /> Skill 产物
          </h3>
          {renderFileList(skillOutputs, 'skill')}
        </div>
      )}

      {others.length > 0 && (
        <div className="overview-section">
          <h3 className="overview-section-title">其他文件</h3>
          {renderFileList(others, 'md')}
        </div>
      )}
    </div>
  )
}

export default OverviewPanel
