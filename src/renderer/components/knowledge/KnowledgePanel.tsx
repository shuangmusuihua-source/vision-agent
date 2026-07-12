import { useEffect, useMemo } from 'react'
import { BookOpenText, GitGraph, RefreshCw } from 'lucide-react'
import GraphView from '../graph/GraphView'
import { useGraphStore } from '../../store/graph-store'
import './KnowledgePanel.css'

interface KnowledgePanelProps {
  knowledgePath: string | null
  activeFile?: string | null
  onOpenFile: (path: string) => void
  onSearchEntity: (entityName: string) => void
}

function getDirectoryLabel(path: string | null): string {
  if (!path) return '知识库目录'
  return path.split('/').filter(Boolean).pop() || path
}

function KnowledgePanel({
  knowledgePath,
  activeFile,
  onOpenFile,
  onSearchEntity,
}: KnowledgePanelProps): React.ReactElement {
  const graphData = useGraphStore((state) => state.graphData)
  const changedFileCount = useGraphStore((state) => state.changedFileCount)
  const isLoading = useGraphStore((state) => state.isLoading)
  const error = useGraphStore((state) => state.error)
  const loadGraphData = useGraphStore((state) => state.loadGraphData)

  useEffect(() => {
    void loadGraphData()
  }, [loadGraphData])

  const stats = useMemo(() => ({
    documents: graphData.nodes.filter((node) => node.type === 'file').length,
    references: graphData.edges.length,
  }), [graphData])

  const handleNodeClick = (nodeId: string, nodeType: string): void => {
    if (nodeType === 'entity') {
      onSearchEntity(nodeId.replace(/^entity:/, ''))
      return
    }
    onOpenFile(nodeId)
  }

  return (
    <div className="knowledge-panel">
      <div className="knowledge-panel-shell">
        <header className="knowledge-toolbar">
          <div className="knowledge-toolbar-context" title={knowledgePath || undefined}>
            <BookOpenText size={16} aria-hidden="true" />
            <h1>知识库</h1>
            <span className="knowledge-toolbar-divider" aria-hidden="true" />
            <span className="knowledge-view-label">
              <GitGraph size={14} aria-hidden="true" />
              图谱
            </span>
          </div>

          <div className="knowledge-toolbar-meta" aria-label="知识库统计">
            <span><strong>{stats.documents}</strong> 文档</span>
            <span><strong>{stats.references}</strong> 链接</span>
          </div>

          <div className="knowledge-toolbar-actions">
            {changedFileCount > 0 && (
              <button
                type="button"
                className="knowledge-change-button"
                onClick={() => void loadGraphData()}
              >
                {changedFileCount} 项变化
              </button>
            )}
            <button
              type="button"
              className="knowledge-refresh-button"
              aria-label={isLoading ? '正在刷新知识库' : '刷新知识库'}
              title={`刷新 ${getDirectoryLabel(knowledgePath)}`}
              onClick={() => void loadGraphData()}
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? 'is-spinning' : undefined} />
            </button>
          </div>
        </header>

        <section className="knowledge-graph-section" aria-label="知识图谱">
            {error ? (
              <div className="knowledge-error" role="alert">
                <div>
                  <strong>知识库加载失败</strong>
                  <span>{error}</span>
                </div>
                <button type="button" onClick={() => void loadGraphData()}>重试</button>
              </div>
            ) : (
              <div className="knowledge-graph-stage" aria-busy={isLoading}>
                <GraphView activeFile={activeFile} onNodeClick={handleNodeClick} />
                {isLoading && graphData.nodes.length === 0 && (
                  <div className="knowledge-loading">正在加载知识库…</div>
                )}
              </div>
            )}
        </section>
      </div>
    </div>
  )
}

export default KnowledgePanel
