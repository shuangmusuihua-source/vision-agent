import { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Info, ChevronDown, Share2 } from 'lucide-react'
import type { GraphNode } from '../../../shared/types'
import { useGraphStore } from '../../store/graph-store'

interface GraphViewProps {
  onNodeClick: (nodeId: string, nodeType: string) => void
  activeFile?: string | null
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
}

const FILE_COLOR = '#2383e2'
const MEMORY_COLOR = '#7c3aed'
const EDGE_COLOR = '#555555'
const HIGHLIGHT_COLOR = '#f59e0b'

function getNodeColor(node: FGNode, highlighted: boolean): string {
  if (highlighted) return HIGHLIGHT_COLOR
  if (node.type === 'memory') return MEMORY_COLOR
  return FILE_COLOR
}

function GraphView({ onNodeClick, activeFile }: GraphViewProps): React.ReactElement {
  const store = useGraphStore
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredData = store(s => s.filteredData)
  const searchQuery = store(s => s.searchQuery)
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
    }))

    return { nodes: fgNodes, links: fgLinks }
  }, [filteredData, highlightedIds])

  // Custom node rendering
  const nodeCanvasObject = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHighlighted = highlightedIds.has(node.id)
    const size = isHighlighted ? 10 : 7

    ctx.save()

    ctx.beginPath()
    ctx.arc(node.x!, node.y!, size, 0, Math.PI * 2)
    ctx.fillStyle = getNodeColor(node, isHighlighted)
    ctx.fill()
    if (isHighlighted) {
      ctx.strokeStyle = HIGHLIGHT_COLOR
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Label
    const fontSize = Math.max(10 / globalScale, 6)
    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isHighlighted ? HIGHLIGHT_COLOR : '#888888'
    const label = node.label.length > 12 ? node.label.substring(0, 11) + '…' : node.label
    ctx.fillText(label, node.x!, node.y! + size + 2)

    ctx.restore()
  }, [highlightedIds])

  // Custom link rendering
  const linkCanvasObject = useCallback((link: FGLink, ctx: CanvasRenderingContext2D) => {
    const source = link.source as FGNode
    const target = link.target as FGNode
    if (!source.x || !source.y || !target.x || !target.y) return

    ctx.save()
    ctx.strokeStyle = EDGE_COLOR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.stroke()
    ctx.restore()
  }, [])

  // Node label (tooltip)
  const nodeLabel = useCallback((node: FGNode) => {
    return node.label
  }, [])

  // Click handler: single click highlights, double click navigates
  const handleNodeClick = useCallback((node: FGNode) => {
    if (clickTimerRef.current) {
      // Double click — navigate
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      onNodeClick(node.id, node.type)
    } else {
      // Single click — highlight
      setHoveredNode(node)
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
      }, 300)
    }
  }, [onNodeClick])

  // Active file name for title bar
  const activeFileName = activeFile ? activeFile.split('/').pop() || activeFile : null

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
        {changedFileCount > 0 && (
          <span className="graph-change-badge">
            {changedFileCount} changed
          </span>
        )}
      </div>
      <div className="graph-title-bar">
        <Share2 size={14} className="graph-title-icon" />
        <span className="graph-title-label">知识图谱</span>
        {activeFileName && (
          <>
            <span className="graph-title-sep">·</span>
            <span className="graph-title-file">当前：{activeFileName}</span>
          </>
        )}
        {hoveredNode && (
          <span className="graph-title-hint">单击高亮 · 双击跳转</span>
        )}
      </div>
      <div className="graph-canvas">
        {fgData.nodes.length > 0 ? (
          <>
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
            onNodeClick={handleNodeClick}
            onBackgroundClick={() => setHoveredNode(null)}
            nodeLabel={nodeLabel}
            backgroundColor="transparent"
            warmupTicks={50}
            cooldownTicks={100}
            d3AlphaDecay={0.01}
            d3VelocityDecay={0.3}
            nodeVal={(node) => node.val ?? 12}
          />
          {hoveredNode && (
            <div className="graph-node-tooltip">
              <span className="graph-node-tooltip-type">{hoveredNode.type === 'memory' ? 'Memory' : 'File'}</span>
              <span className="graph-node-tooltip-path">{hoveredNode.label}</span>
            </div>
          )}
          </>
        ) : (
          <div className="graph-empty">No nodes to display</div>
        )}
        <div className={`graph-legend-card${legendCollapsed ? ' collapsed' : ''}`}>
          <button className="graph-legend-toggle" onClick={() => setLegendCollapsed(!legendCollapsed)}>
            {legendCollapsed ? <Info size={14} /> : <ChevronDown size={14} />}
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
                <span className="graph-legend-line" style={{ background: EDGE_COLOR }} />
                Reference
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GraphView
