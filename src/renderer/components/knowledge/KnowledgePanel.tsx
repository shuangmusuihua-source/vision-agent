import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, GitGraph, List, RefreshCw, Search, Sparkles, Undo2, ArrowUpRight, FileText } from 'lucide-react'
import GraphView from '../graph/GraphView'
import { useGraphStore } from '../../store/graph-store'
import { useModal } from '../common/ModalSystem'
import type { KnowledgeCatalog } from '../../../shared/curation-types'
import './KnowledgePanel.css'
import './Curation.css'

interface KnowledgePanelProps {
  knowledgePath: string | null
  activeFile?: string | null
  onOpenFile: (path: string) => void
  onSearchEntity: (entityName: string) => void
  onCurate: (paths: string[]) => void
  onUse: (paths: string[]) => void
  revision: number
}

export default function KnowledgePanel({ knowledgePath, activeFile, onOpenFile, onSearchEntity, onCurate, onUse, revision }: KnowledgePanelProps): React.ReactElement {
  const modal = useModal()
  const graphData = useGraphStore(state => state.graphData)
  const loadGraphData = useGraphStore(state => state.loadGraphData)
  const [catalog, setCatalog] = useState<KnowledgeCatalog>({ documents: [], canUndo: false })
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'source' | 'topic' | 'graph'>('source')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const loadEpoch = useRef(0)
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const result = await window.api.graph.knowledgeCatalog()
      if (epoch !== loadEpoch.current) return
      if (!result.success) throw new Error(result.error)
      setCatalog(result.value)
      setSelected(current => current.filter(path => result.value.documents.some(file => file.path === path)))
      setError('')
    } catch (err) { if (epoch === loadEpoch.current) setError(err instanceof Error ? err.message : '知识库加载失败') }
    finally { if (epoch === loadEpoch.current) setLoading(false) }
  }, [])
  useEffect(() => () => { loadEpoch.current++ }, [])
  useEffect(() => { void load(); void loadGraphData() }, [load, loadGraphData, revision])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const off = window.api.graph.onFilesChanged(() => { clearTimeout(timer); timer = setTimeout(() => { void load() }, 300) })
    return () => { clearTimeout(timer); off() }
  }, [load])
  const visible = useMemo(() => catalog.documents.filter(file => file.kind === tab && `${file.title} ${file.description}`.toLowerCase().includes(query.toLowerCase())), [catalog, tab, query])
  const sources = selected.filter(path => catalog.documents.some(file => file.path === path && file.kind === 'source' && !file.unavailableReason))
  const undo = async () => {
    if (!await modal.confirm({ title: '撤回上次整理？', message: '新建主题将被移除，更新的主题将恢复原文。如果主题已被你编辑，会保留修改并停止撤回。', confirmLabel: '撤回整理' })) return
    setUndoing(true)
    try {
      const result = await window.api.graph.undoKnowledge()
      if (!result.success) throw new Error(result.error)
      await load(); await loadGraphData()
    } catch (err) { setError(String(err)) }
    finally { setUndoing(false) }
  }
  return <div className="knowledge-panel"><div className="knowledge-panel-shell">
    <header className="knowledge-toolbar">
      <div className="knowledge-toolbar-context" title={knowledgePath || undefined}><BookOpenText size={16} /><h1>知识库</h1></div>
      <div className="knowledge-toolbar-meta"><span><strong>{catalog.documents.length}</strong> 文档</span><span><strong>{graphData.edges.length}</strong> 链接</span></div>
      <button type="button" className="curation-button curation-icon" aria-label="刷新知识库" disabled={loading} onClick={() => { void load(); void loadGraphData() }}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} /></button>
    </header>
    <div className="knowledge-library-intro"><span>把资料积累成自己的知识</span><p>保存原始资料，提炼主题和关联；需要时带入下一次任务。</p></div>
    <div className="knowledge-library-controls">
      <div className="knowledge-library-tabs">{(['source', 'topic', 'graph'] as const).map(value => <button type="button" key={value} className="curation-button" aria-pressed={tab === value} onClick={() => { setTab(value); setSelected([]) }}>{value === 'graph' ? <GitGraph size={14} /> : <List size={14} />}{value === 'source' ? '原始资料' : value === 'topic' ? '主题知识' : '知识图谱'}</button>)}</div>
      {catalog.canUndo && <button type="button" className="curation-button" disabled={undoing} onClick={() => void undo()}><Undo2 size={14} />撤回上次整理</button>}
    </div>
    {error && <div className="knowledge-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
    {tab === 'graph' ? <section className="knowledge-graph-section" aria-label="知识图谱"><div className="knowledge-graph-stage"><GraphView activeFile={activeFile} onNodeClick={(id, type) => type === 'entity' ? onSearchEntity(id.replace(/^entity:/, '')) : onOpenFile(id)} /></div></section>
      : <>
        <div className="knowledge-library-actions"><label className="knowledge-library-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题和摘要" aria-label="搜索知识库" /></label>
          {tab === 'source' && <button type="button" className="curation-button curation-primary" disabled={!sources.length || sources.length > 8} onClick={() => onCurate(sources)}><Sparkles size={14} />整理资料{sources.length ? ` (${sources.length})` : ''}</button>}
          <button type="button" className="curation-button" disabled={!selected.length} onClick={() => onUse(selected)}><ArrowUpRight size={14} />用于任务</button>
        </div>
        <div className="knowledge-document-list" aria-busy={loading}>
          {!visible.length && <div className="knowledge-library-empty"><BookOpenText size={28} /><h3>{loading ? '正在加载…' : query ? '没有匹配的文档' : tab === 'topic' ? '让资料形成主题' : '从一份有价值的资料开始'}</h3><p>{tab === 'topic' ? '在原始资料中勾选文档，点击「整理资料」。' : '在任务成果中把 Markdown 文档加入知识库，就可以在这里整理和复用。'}</p></div>}
          {visible.map(file => <article key={file.path} className="knowledge-document-row"><input type="checkbox" aria-label={`选择 ${file.title}`} checked={selected.includes(file.path)} onChange={event => setSelected(current => event.target.checked ? [...current, file.path] : current.filter(path => path !== file.path))} /><FileText size={18} /><button type="button" onClick={() => onOpenFile(file.path)}><strong>{file.title}</strong><span>{file.unavailableReason || file.description || file.path.slice((knowledgePath?.length || 0) + 1)}</span></button>{file.kind === 'source' && <small data-status={file.status}>{file.status === 'current' ? '已整理' : file.status === 'changed' ? '有更新' : '待整理'}</small>}<time>{new Date(file.modifiedAt).toLocaleDateString('zh-CN')}</time></article>)}
        </div>
        <div className="knowledge-library-footnote">{selected.length ? `已选择 ${selected.length} 份 · 每次最多整理 8 份资料` : `${visible.length} 份${tab === 'source' ? '原始资料' : '主题知识'}`}</div>
      </>}
  </div></div>
}
