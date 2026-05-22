import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Lightning, Spinner, Info, CaretDown } from '@phosphor-icons/react'
import type { GraphNode, GraphEdge } from '../../lib/ipc'

interface GraphViewProps {
  onNodeClick: (nodeId: string, nodeType: string) => void
  changedFileCount: number
  onClearChangedFiles: () => void
}

interface FGNode extends GraphNode {
  val?: number
  color?: string
  x?: number
  y?: number
}

interface FGLink {
  source: FGNode | string
  target: FGNode | string
  label?: string
  type: 'reference' | 'semantic'
  color?: string
}

const FILE_COLOR = '#2383e2'
const MEMORY_COLOR = '#7c3aed'
const ENTITY_COLOR = '#e8a838'
const REFERENCE_EDGE_COLOR = '#555555'
const SEMANTIC_EDGE_COLOR = '#e8a838'
const HIGHLIGHT_COLOR = '#f59e0b'

type FilterMode = 'all' | 'reference' | 'semantic'

function getNodeColor(node: FGNode, highlighted: boolean): string {
  if (highlighted) return HIGHLIGHT_COLOR
  if (node.type === 'entity') return ENTITY_COLOR
  if (node.type === 'memory') return MEMORY_COLOR
  return FILE_COLOR
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - size)
  ctx.lineTo(x + size, y)
  ctx.lineTo(x, y + size)
  ctx.lineTo(x - size, y)
  ctx.closePath()
}

function GraphView({ onNodeClick, changedFileCount, onClearChangedFiles }: GraphViewProps): React.ReactElement {
  const fgRef = useRef<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const [extracting, setExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState({ phase: '', progress: 0 })
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [legendCollapsed, setLegendCollapsed] = useState(false)

  // Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect()
        setDimensions({ width, height })
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Load graph data
  useEffect(() => {
    window.api.graph.getData().then(setGraphData).catch(console.error)
  }, [filter])

  // Semantic extraction progress
  useEffect(() => {
    const unsub = window.api.graph.onSemanticProgress((data) => {
      setExtractProgress(data)
    })
    return unsub
  }, [])

  const handleExtractSemantic = useCallback(async () => {
    setExtracting(true)
    setExtractProgress({ phase: 'starting', progress: 0 })
    try {
      const result = await window.api.graph.extractSemantic()
      if (result.skipped) {
        setExtractProgress({ phase: 'no changes', progress: 1 })
      } else {
        onClearChangedFiles()
      }
      const data = await window.api.graph.getData()
      setGraphData(data)
    } catch (err) {
      console.error('[GraphView] Semantic extraction failed:', err)
    }
    setExtracting(false)
  }, [onClearChangedFiles])

  // Search highlighting
  useEffect(() => {
    if (!searchQuery.trim()) {
      setHighlightedIds(new Set())
      return
    }
    const q = searchQuery.toLowerCase()
    const ids = new Set(graphData.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id))
    setHighlightedIds(ids)
  }, [searchQuery, graphData.nodes])

  // Filtered data
  const filteredData = useMemo(() => {
    let nodes = graphData.nodes
    let edges = graphData.edges

    if (filter === 'reference') {
      nodes = nodes.filter((n) => n.type === 'file' || n.type === 'memory')
      edges = edges.filter((e) => e.type === 'reference')
    } else if (filter === 'semantic') {
      const entityIds = new Set(nodes.filter((n) => n.type === 'entity').map((n) => n.id))
      nodes = nodes.filter((n) => n.type === 'entity' || entityIds.size === 0)
      edges = edges.filter((e) => e.type === 'semantic')
    }

    // Ensure all link endpoints reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id))
    const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    const fgNodes: FGNode[] = nodes.map((n) => ({
      ...n,
      val: highlightedIds.has(n.id) ? 20 : 12,
      color: getNodeColor(n, highlightedIds.has(n.id)),
    }))

    const fgLinks: FGLink[] = validEdges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
      type: e.type,
      color: e.type === 'semantic' ? SEMANTIC_EDGE_COLOR : REFERENCE_EDGE_COLOR,
    }))

    return { nodes: fgNodes, links: fgLinks }
  }, [graphData, filter, highlightedIds])

  // Custom node rendering
  const nodeCanvasObject = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHighlighted = highlightedIds.has(node.id)
    const size = isHighlighted ? 10 : 7

    ctx.save()

    if (node.type === 'entity') {
      drawDiamond(ctx, node.x!, node.y!, size)
      ctx.fillStyle = getNodeColor(node, isHighlighted)
      ctx.fill()
      if (isHighlighted) {
        ctx.strokeStyle = HIGHLIGHT_COLOR
        ctx.lineWidth = 2
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, size, 0, Math.PI * 2)
      ctx.fillStyle = getNodeColor(node, isHighlighted)
      ctx.fill()
      if (isHighlighted) {
        ctx.strokeStyle = HIGHLIGHT_COLOR
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Label
    const fontSize = Math.max(10 / globalScale, 6)
    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isHighlighted ? HIGHLIGHT_COLOR : 'var(--color-text-secondary)'

    // Canvas doesn't support CSS variables, use actual color
    ctx.fillStyle = isHighlighted ? HIGHLIGHT_COLOR : '#888888'
    const label = node.label.length > 12 ? node.label.substring(0, 11) + '…' : node.label
    const yOffset = node.type === 'entity' ? size + 2 : size + 2
    ctx.fillText(label, node.x!, node.y! + yOffset)

    ctx.restore()
  }, [highlightedIds])

  // Custom link rendering
  const linkCanvasObject = useCallback((link: FGLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source as FGNode
    const target = link.target as FGNode
    if (!source.x || !source.y || !target.x || !target.y) return

    ctx.save()

    if (link.type === 'semantic') {
      ctx.setLineDash([4, 2])
      ctx.strokeStyle = SEMANTIC_EDGE_COLOR
      ctx.lineWidth = 1.5
    } else {
      ctx.setLineDash([])
      ctx.strokeStyle = REFERENCE_EDGE_COLOR
      ctx.lineWidth = 1
    }

    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.stroke()

    // Label for semantic edges
    if (link.type === 'semantic' && link.label) {
      const fontSize = Math.max(8 / globalScale, 5)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = SEMANTIC_EDGE_COLOR
      const midX = (source.x + target.x) / 2
      const midY = (source.y + target.y) / 2
      ctx.fillText(link.label, midX, midY - 2)
    }

    ctx.restore()
  }, [])

  // Node label (tooltip)
  const nodeLabel = useCallback((node: FGNode) => {
    const typeInfo = node.type === 'entity' ? ` (${node.entityType || 'entity'})` : ''
    return `${node.label}${typeInfo}`
  }, [])

  return (
    <div ref={containerRef} className="graph-view">
      <div className="graph-toolbar">
        <input
          className="graph-search"
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="graph-filter-group">
          <button className={`graph-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`graph-filter-btn${filter === 'reference' ? ' active' : ''}`} onClick={() => setFilter('reference')}>References</button>
          <button className={`graph-filter-btn${filter === 'semantic' ? ' active' : ''}`} onClick={() => setFilter('semantic')}>Semantic</button>
        </div>
        <button
          className="graph-extract-btn"
          onClick={handleExtractSemantic}
          disabled={extracting}
          title="Extract semantic graph from documents"
        >
          {extracting ? <Spinner size={16} weight="regular" /> : <Lightning size={16} weight="regular" />}
          {extracting ? ` ${extractProgress.phase}...` : extractProgress.phase === 'no changes' ? ' No changes' : ' Extract'}
        </button>
        {changedFileCount > 0 && (
          <span className="graph-change-badge">
            {changedFileCount} changed
          </span>
        )}
      </div>
      <div className="graph-canvas">
        {filteredData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={filteredData}
            nodeId="id"
            nodeCanvasObject={nodeCanvasObject}
            linkCanvasObject={linkCanvasObject}
            linkDirectionalArrowLength={0}
            linkColor={() => 'transparent'}
            linkWidth={0}
            linkLineDash={null}
            onNodeClick={(node) => onNodeClick(node.id, node.type)}
            nodeLabel={nodeLabel}
            backgroundColor="transparent"
            warmupTicks={50}
            cooldownTicks={100}
            d3AlphaDecay={0.01}
            d3VelocityDecay={0.3}
            linkDistance={60}
            nodeVal={(node) => node.val}
          />
        ) : (
          <div className="graph-empty">No nodes to display</div>
        )}
        <div className={`graph-legend-card${legendCollapsed ? ' collapsed' : ''}`}>
          <button className="graph-legend-toggle" onClick={() => setLegendCollapsed(!legendCollapsed)}>
            {legendCollapsed ? <Info size={14} /> : <CaretDown size={14} />}
          </button>
          {!legendCollapsed && (
            <div className="graph-legend-items">
              <span className="graph-legend-item">
                <span className="graph-legend-dot" style={{ background: FILE_COLOR }} />
                File
              </span>
              <span className="graph-legend-item">
                <span className="graph-legend-dot" style={{ background: MEMORY_COLOR }} />
                Memory
              </span>
              <span className="graph-legend-item">
                <span className="graph-legend-diamond" style={{ background: ENTITY_COLOR }} />
                Entity
              </span>
              <span className="graph-legend-item">
                <span className="graph-legend-line" style={{ background: REFERENCE_EDGE_COLOR }} />
                Ref
              </span>
              <span className="graph-legend-item">
                <span className="graph-legend-line dashed" style={{ background: SEMANTIC_EDGE_COLOR }} />
                Semantic
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GraphView
