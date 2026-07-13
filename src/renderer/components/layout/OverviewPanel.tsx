import { useState } from 'react'
import {
  ArrowUpRight,
  BookPlus,
  CircleCheck,
  FileText,
  FilePenLine,
  FolderOpen,
  LoaderCircle,
  PackageOpen,
  Presentation,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useAgentStore } from '../../store/agent-store-impl'
import type { SessionOutputEntry } from '../../../shared/types'

interface OverviewPanelProps {
  sessionId: string | null
  activeFilePath?: string
  onOpenFile: (path: string) => void
  onAddToKnowledge: (path: string) => Promise<{ success: boolean; alreadyExists?: boolean; updated?: boolean; error?: string }>
  onRevealOutput: (path: string) => Promise<void>
  onDeleteOutput: (file: SessionOutputEntry) => Promise<boolean>
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatFileSize(size = 0): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatSkillName(skillId?: string): string {
  if (!skillId) return '生成方式未记录'
  return skillId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function fileBadge(file: SessionOutputEntry): string {
  return file.fileType === 'other' ? 'FILE' : file.fileType.toUpperCase()
}

function cardDetailLabel(file: SessionOutputEntry, fallback: string): string {
  const relativePath = file.relativePath?.trim()
  if (!relativePath || relativePath === file.fileName) return fallback

  const segments = relativePath.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 1) return fallback

  const lastSegment = segments[segments.length - 1]
  if (lastSegment === file.fileName) {
    const parentPath = segments.slice(0, -1).join(' / ')
    return parentPath || fallback
  }

  return relativePath
}

function OverviewPanel({
  sessionId,
  activeFilePath,
  onOpenFile,
  onAddToKnowledge,
  onRevealOutput,
  onDeleteOutput,
}: OverviewPanelProps): React.ReactElement {
  const sessionOutputs = useAgentStore((s) => s.sessionOutputs)
  const [busyFiles, setBusyFiles] = useState<Record<string, 'knowledge' | 'delete'>>({})

  if (!sessionId) {
    return (
      <div className="overview-panel">
        <div className="overview-empty">
          <div className="overview-empty-icon"><FileText size={48} /></div>
          <h3>未选择会话</h3>
          <p>请从侧边栏选择一个会话，查看其文档和交付产物</p>
        </div>
      </div>
    )
  }

  if (!sessionOutputs || sessionOutputs.sessionId !== sessionId || sessionOutputs.files.length === 0) {
    return (
      <div className="overview-panel">
        <div className="overview-hero overview-hero--compact">
          <p className="overview-subtitle overview-subtitle--solo">本次协作形成的文档与交付产物，会集中归档在这里。</p>
        </div>
        <div className="overview-empty overview-empty--framed">
          <div className="overview-empty-icon"><FileText size={36} /></div>
          <h3>当前会话尚未产生文件</h3>
          <p>与 Agent 开始协作后，新文档和 Skill 产物会自动出现在这里</p>
        </div>
      </div>
    )
  }

  const documents = sessionOutputs.files.filter((file) => file.category === 'document' && file.fileType === 'md')
  const skillOutputs = sessionOutputs.files.filter((file) => file.category === 'skill_output')
  const others = sessionOutputs.files.filter((file) => !documents.includes(file) && !skillOutputs.includes(file))

  const handleKnowledgeAction = async (file: SessionOutputEntry): Promise<void> => {
    if (busyFiles[file.filePath] || file.knowledge?.status === 'synced') return
    setBusyFiles((current) => ({ ...current, [file.filePath]: 'knowledge' }))
    try {
      await onAddToKnowledge(file.filePath)
    } finally {
      setBusyFiles((current) => {
        const next = { ...current }
        delete next[file.filePath]
        return next
      })
    }
  }

  const handleDelete = async (file: SessionOutputEntry): Promise<void> => {
    if (busyFiles[file.filePath]) return
    setBusyFiles((current) => ({ ...current, [file.filePath]: 'delete' }))
    try {
      await onDeleteOutput(file)
    } finally {
      setBusyFiles((current) => {
        const next = { ...current }
        delete next[file.filePath]
        return next
      })
    }
  }

  const renderDocument = (file: SessionOutputEntry) => {
    const isActive = activeFilePath === file.filePath
    const isBusy = busyFiles[file.filePath] === 'knowledge'
    const knowledgeStatus = file.knowledge?.status || 'not_added'
    const knowledgeLabel = knowledgeStatus === 'synced'
      ? '已同步知识库'
      : knowledgeStatus === 'update_available'
        ? '同步最新版本'
        : '加入知识库'

    return (
      <article className={`overview-card overview-card--document${isActive ? ' overview-card--active' : ''}`} key={file.filePath}>
        <div className="overview-card-head">
          <div className="overview-card-icon overview-card-icon--document"><FilePenLine size={19} strokeWidth={1.6} /></div>
          <div className="overview-card-identity">
            <button className="overview-card-name" type="button" onClick={() => onOpenFile(file.filePath)} title={file.filePath}>
              {file.fileName}
            </button>
            <span className="overview-card-subline">
              <span className="overview-format-badge">MD</span>
              <span className="overview-card-path">{cardDetailLabel(file, '工作文档')}</span>
            </span>
          </div>
          <div className="overview-card-toolbar">
            <button className="overview-icon-action" type="button" onClick={() => onOpenFile(file.filePath)} title="打开文档" aria-label={`打开 ${file.fileName}`}>
              <ArrowUpRight size={16} />
            </button>
            <button
              className={`overview-icon-action overview-icon-action--knowledge overview-icon-action--${knowledgeStatus}`}
              type="button"
              onClick={() => void handleKnowledgeAction(file)}
              disabled={isBusy}
              aria-disabled={knowledgeStatus === 'synced'}
              title={isBusy ? '正在同步知识库' : knowledgeLabel}
              aria-label={`${knowledgeLabel}：${file.fileName}`}
            >
              {isBusy
                ? <LoaderCircle size={16} className="overview-spin" />
                : knowledgeStatus === 'synced'
                  ? <CircleCheck size={16} />
                  : knowledgeStatus === 'update_available'
                    ? <RefreshCw size={16} />
                    : <BookPlus size={16} />}
            </button>
          </div>
        </div>

        <dl className="overview-meta-grid">
          <div><dt>创建</dt><dd>{formatDateTime(file.createdAt)}</dd></div>
          <div><dt>修改</dt><dd>{formatDateTime(file.modifiedAt)}</dd></div>
          <div><dt>大小</dt><dd>{formatFileSize(file.size)}</dd></div>
        </dl>

        <div className={`overview-sync-state overview-sync-state--${knowledgeStatus}`}>
          {knowledgeStatus === 'synced'
            ? <CircleCheck size={15} />
            : knowledgeStatus === 'update_available'
              ? <RefreshCw size={15} />
              : <BookPlus size={15} />}
          <span>{knowledgeStatus === 'synced' ? '知识库已最新' : knowledgeStatus === 'update_available' ? '待同步最新' : '尚未入库'}</span>
        </div>
      </article>
    )
  }

  const renderArtifact = (file: SessionOutputEntry) => {
    const isBusy = busyFiles[file.filePath] === 'delete'
    return (
      <article className="overview-card overview-card--artifact" key={file.filePath}>
        <div className="overview-card-head">
          <div className="overview-card-icon overview-card-icon--artifact"><Presentation size={19} strokeWidth={1.6} /></div>
          <div className="overview-card-identity">
            <button className="overview-card-name" type="button" onClick={() => onOpenFile(file.filePath)} title={file.filePath}>
              {file.fileName}
            </button>
            <span className="overview-card-subline">
              <span className={`overview-format-badge overview-format-badge--${file.fileType}`}>{fileBadge(file)}</span>
              <span className="overview-card-path">{cardDetailLabel(file, 'Skill 产物')}</span>
            </span>
          </div>
          <div className="overview-card-toolbar">
            <button className="overview-icon-action" type="button" onClick={() => onOpenFile(file.filePath)} title="打开产物" aria-label={`打开 ${file.fileName}`}>
              <ArrowUpRight size={16} />
            </button>
            <button className="overview-icon-action" type="button" onClick={() => void onRevealOutput(file.filePath)} title="在访达中显示" aria-label={`在访达中显示 ${file.fileName}`}>
              <FolderOpen size={16} />
            </button>
            <button className="overview-icon-action overview-icon-action--danger" type="button" onClick={() => void handleDelete(file)} disabled={isBusy} title="删除产物" aria-label={`删除 ${file.fileName}`}>
              {isBusy ? <LoaderCircle size={16} className="overview-spin" /> : <Trash2 size={16} />}
            </button>
          </div>
        </div>

        <div className="overview-artifact-summary">
          <div className="overview-asset-chip">
            <FileText size={14} />
            {file.provenance?.sourceDocumentPath ? (
              <button type="button" onClick={() => onOpenFile(file.provenance!.sourceDocumentPath!)}>
                {file.provenance.sourceDocumentName || '打开文档'}
              </button>
            ) : <span>未关联文档</span>}
          </div>
          <div className="overview-asset-chip">
            <PackageOpen size={14} />
            <span>{formatSkillName(file.provenance?.skillId)}</span>
          </div>
        </div>

        <dl className="overview-meta-grid overview-meta-grid--artifact">
          <div><dt>创建</dt><dd>{formatDateTime(file.createdAt)}</dd></div>
          <div><dt>修改</dt><dd>{formatDateTime(file.modifiedAt)}</dd></div>
          <div><dt>大小</dt><dd>{formatFileSize(file.size)}</dd></div>
        </dl>
      </article>
    )
  }

  return (
    <div className="overview-panel">
      <header className="overview-hero overview-hero--compact">
        <p className="overview-subtitle overview-subtitle--solo">从工作文档到最终交付，所有成果都在同一处持续维护。</p>
        <div className="overview-summary" aria-label="会话文件统计">
          <span><strong>{documents.length}</strong> 文档</span>
          <span><strong>{skillOutputs.length}</strong> 产物</span>
          <span><strong>{sessionOutputs.files.length}</strong> 文件</span>
        </div>
      </header>

      {documents.length > 0 && (
        <section className="overview-section">
          <div className="overview-section-head">
            <div>
              <h3 className="overview-section-title"><FilePenLine size={16} strokeWidth={1.6} /> 工作文档 <span>{documents.length}</span></h3>
              <p>持续编辑，并将确认后的最新版本同步到知识库。</p>
            </div>
          </div>
          <div className="overview-card-grid">{documents.map(renderDocument)}</div>
        </section>
      )}

      {skillOutputs.length > 0 && (
        <section className="overview-section">
          <div className="overview-section-head">
            <div>
              <h3 className="overview-section-title"><PackageOpen size={16} strokeWidth={1.6} /> Skill 产物 <span>{skillOutputs.length}</span></h3>
              <p>由文档和会话上下文生成的可交付文件。</p>
            </div>
          </div>
          <div className="overview-card-grid">{skillOutputs.map(renderArtifact)}</div>
        </section>
      )}

      {others.length > 0 && (
        <section className="overview-section overview-section--other">
          <div className="overview-section-head">
            <div>
              <h3 className="overview-section-title"><FolderOpen size={16} strokeWidth={1.6} /> 其他文件 <span>{others.length}</span></h3>
            </div>
          </div>
          <div className="overview-other-list">
            {others.map((file) => (
              <button type="button" key={file.filePath} onClick={() => onOpenFile(file.filePath)}>
                <FileText size={16} /><span>{file.fileName}</span><small>{formatFileSize(file.size)}</small><ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default OverviewPanel
