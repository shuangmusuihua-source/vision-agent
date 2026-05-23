import { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Lightning, Spinner, Info, CaretDown } from '@phosphor-icons/react'
import type { GraphNode, GraphEdge } from '../../../shared/types'
import { useGraphStore } from '../../store/graph-store'

interface GraphViewProps {
  onNodeClick: (nodeId: string, nodeType: string) => void
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

function GraphView({ onNodeClick }: GraphViewProps): React.ReactElement {
  const store = useGraphStore
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [legendCollapsed, setLegendCollapsed] = useState(false)

  const filteredData = store(s => s.filteredData)
  const extractionState = store(s => s.extractionState)
  const extractionProgress = store(s => s.extractionProgress)
  const searchQuery = store(s => s.searchQuery)
  const filter = store(s => s.filter)
  const changedFileCount = store(s => s.changedFileCount)

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

  // Load graph data on mount
  useEffect(() => {
    store.getState().loadGraphData()
  }, [])

  // Semantic extraction progress
  useEffect(() => {
    const unsub = window.api.graph.onSemanticProgress((data) => {
      store.getState().setExtractionProgress(data)
    })
    return unsub
  }, [])

  const handleExtractSemantic = useCallback(async () => {
    await store.getState().startExtraction()
  }, [])

  // Search highlighting
  const highlightedIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.toLowerCase()
    return new Set(filteredData.nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id))
  }, [searchQuery, filteredData.nodes])

  // Prepare force-graph data
  const fgData = useMemo(() => {
    const fgNodes: FGNode[] = filteredData.nodes.map(n => ({
      ...n,
      val: highlightedIds.has(n.id) ? 20 : 12,
      color: getNodeColor(n as FGNode, highlightedIds.has(n.id)),
    }))

    const fgLinks: FGLink[] = filteredData.edges.map(e => ({
      source: e.source,
      target: e.target,
      label: e.label,
      type: e.type,
      color: e.type === 'semantic' ? SEMANTIC_EDGE_COLOR : REFERENCE_EDGE_COLOR,
    }))

    return { nodes: fgNodes, links: fgLinks }
  }, [filteredData, highlightedIds])

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

  const isExtracting = extractionState === 'indexing' || extractionState === 'extracting' || extractionState === 'merging'

  return (
    <div ref={containerRef} className="graph-view">
      <div className="graph-toolbar">
        <input
          className="graph-search"
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => store.getState().setSearchQuery(e.target.value)}
        />
        <div className="graph-filter-group">
          <button className={`graph-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => store.getState().setFilter('all')}>All</button>
          <button className={`graph-filter-btn${filter === 'reference' ? ' active' : ''}`} onClick={() => store.getState().setFilter('reference')}>References</button>
          <button className={`graph-filter-btn${filter === 'semantic' ? ' active' : ''}`} onClick={() => store.getState().setFilter('semantic')}>Semantic</button>
        </div>
        <button
          className="graph-extract-btn"
          onClick={handleExtractSemantic}
          disabled={isExtracting}
          title="Extract semantic graph from documents"
        >
          {isExtracting ? <Spinner size={16} weight="regular" /> : <Lightning size={16} weight="regular" />}
          {isExtracting ? ` ${extractionProgress?.phase || 'extracting'}...` : extractionState === 'complete' && !extractionProgress ? ' Done' : ' Extract'}
        </button>
        {changedFileCount > 0 && (
          <span className="graph-change-badge">
            {changedFileCount} changed
          </span>
        )}
      </div>
      <div className="graph-canvas">
        {fgData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={fgData}
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
