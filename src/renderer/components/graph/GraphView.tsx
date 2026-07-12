import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { ArrowUpRight, ChevronDown, Info } from 'lucide-react'
import type { GraphNode } from '../../../shared/types'
import { useGraphStore } from '../../store/graph-store'

interface GraphViewProps {
  onNodeClick: (nodeId: string, nodeType: string) => void
  activeFile?: string | null
}

interface FGNode extends GraphNode {
  x?: number
  y?: number
}

interface FGLink {
  source: FGNode | string
  target: FGNode | string
}

interface GraphPalette {
  file: string
  active: string
  selected: string
  edge: string
  label: string
}

const DEFAULT_PALETTE: GraphPalette = {
  file: '#2383e2',
  active: '#1d4ed8',
  selected: '#f59e0b',
  edge: '#8b8b8b',
  label: '#737373',
}
const MAX_AUTO_ZOOM = 1.6
const LARGE_GRAPH_NODE_COUNT = 150
const nodePositionCache = new Map<string, { x: number; y: number }>()

function getNodeColor(isActive: boolean, palette: GraphPalette): string {
  if (isActive) return palette.active
  return palette.file
}

function cacheNodePosition(node: FGNode): void {
  if (typeof node.x !== 'number' || typeof node.y !== 'number') return
  nodePositionCache.set(node.id, { x: node.x, y: node.y })
}

function readGraphPalette(): GraphPalette {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback
  return {
    file: read('--graph-node-file', DEFAULT_PALETTE.file),
    active: read('--graph-node-active', DEFAULT_PALETTE.active),
    selected: read('--graph-node-selected', DEFAULT_PALETTE.selected),
    edge: read('--graph-edge', DEFAULT_PALETTE.edge),
    label: read('--graph-label', DEFAULT_PALETTE.label),
  }
}

function GraphView({ onNodeClick, activeFile }: GraphViewProps): React.ReactElement {
  const fgRef = useRef<any>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const hasFitRef = useRef(false)
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFittedDimensionsRef = useRef<{ width: number; height: number } | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [palette, setPalette] = useState<GraphPalette>(DEFAULT_PALETTE)
  const [legendCollapsed, setLegendCollapsed] = useState(true)
  const [layoutSettled, setLayoutSettled] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null)
  const [selectedNode, setSelectedNode] = useState<FGNode | null>(null)

  const graphData = useGraphStore((state) => state.graphData)

  useEffect(() => {
    const updatePalette = (): void => setPalette(readGraphPalette())
    updatePalette()
    const observer = new MutationObserver(updatePalette)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Observe only the canvas host. Observing the whole graph (toolbar included) caused
  // the canvas height to feed back into its parent and grow on every resize pass.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const updateDimensions = (width: number, height: number): void => {
      const next = { width: Math.round(width), height: Math.round(height) }
      if (next.width <= 0 || next.height <= 0) return
      setDimensions((current) => current.width === next.width && current.height === next.height
        ? current
        : next)
    }

    const bounds = canvas.getBoundingClientRect()
    updateDimensions(bounds.width, bounds.height)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateDimensions(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const fgData = useMemo(() => ({
    nodes: graphData.nodes.map((node) => ({
      ...node,
      ...nodePositionCache.get(node.id),
    })) as FGNode[],
    links: graphData.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })) as FGLink[],
  }), [graphData.nodes, graphData.edges])

  useEffect(() => {
    hasFitRef.current = false
    setLayoutSettled(false)
    setHoveredNode(null)
    setSelectedNode(null)
  }, [graphData.nodes, graphData.edges])

  useEffect(() => () => {
    if (hoverClearTimerRef.current) clearTimeout(hoverClearTimerRef.current)
    if (resizeFitTimerRef.current) clearTimeout(resizeFitTimerRef.current)
    fgData.nodes.forEach(cacheNodePosition)
  }, [fgData.nodes])

  const keepHoverCardOpen = useCallback(() => {
    if (!hoverClearTimerRef.current) return
    clearTimeout(hoverClearTimerRef.current)
    hoverClearTimerRef.current = null
  }, [])

  const handleNodeHover = useCallback((node: FGNode | null) => {
    keepHoverCardOpen()
    if (node) {
      setHoveredNode(node)
      return
    }
    hoverClearTimerRef.current = setTimeout(() => {
      setHoveredNode(null)
      hoverClearTimerRef.current = null
    }, 180)
  }, [keepHoverCardOpen])

  const nodeCanvasObject = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    const isActive = activeFile === node.id
    const isHovered = hoveredNode?.id === node.id
    const isSelected = selectedNode?.id === node.id
    const isEmphasized = isActive || isHovered || isSelected
    const radius = (isEmphasized ? 8 : 6) / globalScale

    ctx.save()
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = getNodeColor(isActive, palette)
    ctx.fill()

    if (isActive || isSelected) {
      ctx.strokeStyle = isSelected ? palette.selected : palette.active
      ctx.lineWidth = 2 / globalScale
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius + 3 / globalScale, 0, Math.PI * 2)
      ctx.stroke()
    }

    const labelScaleThreshold = fgData.nodes.length > LARGE_GRAPH_NODE_COUNT ? 1.3 : 0.75
    const shouldDrawLabel = isEmphasized || (layoutSettled && globalScale >= labelScaleThreshold)
    if (!shouldDrawLabel) {
      ctx.restore()
      return
    }

    const fontSize = 10 / globalScale
    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isSelected ? palette.selected : isActive ? palette.active : palette.label
    const label = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label
    ctx.fillText(label, node.x, node.y + radius + 2 / globalScale)
    ctx.restore()
  }, [activeFile, fgData.nodes.length, hoveredNode?.id, layoutSettled, palette, selectedNode?.id])

  const nodePointerAreaPaint = useCallback((
    node: FGNode,
    color: string,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(node.x, node.y, 12 / globalScale, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  const fitGraphToViewport = useCallback((durationMs: number) => {
    const graph = fgRef.current
    if (!graph || dimensions.width <= 0 || dimensions.height <= 0) return
    const bounds = graph.getGraphBbox()
    if (!bounds) return
    const graphWidth = Math.max(bounds.x[1] - bounds.x[0], 1)
    const graphHeight = Math.max(bounds.y[1] - bounds.y[0], 1)
    const padding = 48
    const targetZoom = Math.min(
      MAX_AUTO_ZOOM,
      Math.max(0.1, (dimensions.width - padding * 2) / graphWidth),
      Math.max(0.1, (dimensions.height - padding * 2) / graphHeight),
    )
    graph.centerAt((bounds.x[0] + bounds.x[1]) / 2, (bounds.y[0] + bounds.y[1]) / 2, durationMs)
    graph.zoom(targetZoom, durationMs)
    lastFittedDimensionsRef.current = dimensions
  }, [dimensions])

  const handleEngineStop = useCallback(() => {
    if (hasFitRef.current) return
    hasFitRef.current = true
    fgData.nodes.forEach(cacheNodePosition)
    setLayoutSettled(true)
    fitGraphToViewport(260)
  }, [fgData.nodes, fitGraphToViewport])

  useEffect(() => {
    if (!layoutSettled || dimensions.width <= 0 || dimensions.height <= 0) return
    const previous = lastFittedDimensionsRef.current
    if (!previous) {
      lastFittedDimensionsRef.current = dimensions
      return
    }
    const widthChange = Math.abs(dimensions.width - previous.width) / Math.max(previous.width, 1)
    const heightChange = Math.abs(dimensions.height - previous.height) / Math.max(previous.height, 1)
    if (Math.max(widthChange, heightChange) < 0.1) return

    if (resizeFitTimerRef.current) clearTimeout(resizeFitTimerRef.current)
    resizeFitTimerRef.current = setTimeout(() => {
      fitGraphToViewport(220)
      resizeFitTimerRef.current = null
    }, 160)
    return () => {
      if (resizeFitTimerRef.current) clearTimeout(resizeFitTimerRef.current)
    }
  }, [dimensions, fitGraphToViewport, layoutSettled])

  const visibleNode = hoveredNode ?? selectedNode

  return (
    <div className="graph-view">
      <div ref={canvasRef} className="graph-canvas">
        {fgData.nodes.length > 0 ? (
          dimensions.width > 0 && dimensions.height > 0 && (
            <>
              <ForceGraph2D
                ref={fgRef}
                width={dimensions.width}
                height={dimensions.height}
                graphData={fgData}
                nodeId="id"
                nodeCanvasObject={nodeCanvasObject}
                nodePointerAreaPaint={nodePointerAreaPaint}
                linkColor={() => palette.edge}
                linkWidth={1}
                linkDirectionalArrowLength={0}
                onNodeClick={(node) => {
                  const selected = node as FGNode
                  setSelectedNode(selected)
                  setHoveredNode(selected)
                }}
                onNodeDragEnd={(node) => cacheNodePosition(node as FGNode)}
                onNodeHover={(node) => handleNodeHover(node as FGNode | null)}
                onBackgroundClick={() => {
                  setHoveredNode(null)
                  setSelectedNode(null)
                }}
                backgroundColor="transparent"
                cooldownTicks={70}
                d3AlphaDecay={0.05}
                d3VelocityDecay={0.4}
                onEngineStop={handleEngineStop}
                nodeVal={10}
              />
              {visibleNode && (
                <div
                  className="graph-node-tooltip"
                  role="group"
                  aria-label={`${visibleNode.label} 节点操作`}
                  onMouseEnter={keepHoverCardOpen}
                  onMouseLeave={() => handleNodeHover(null)}
                  onFocus={keepHoverCardOpen}
                >
                  <span className="graph-node-tooltip-type">
                    {visibleNode.type === 'entity' ? '实体' : '文档'}
                  </span>
                  <span className="graph-node-tooltip-path">{visibleNode.label}</span>
                  <button
                    type="button"
                    className="graph-node-tooltip-action"
                    onClick={() => onNodeClick(visibleNode.id, visibleNode.type)}
                  >
                    {visibleNode.type === 'entity' ? '查看实体' : '查看文档'}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )
        ) : (
          <div className="graph-empty">知识库中还没有可展示的文档节点</div>
        )}
        <div className={`graph-legend-card${legendCollapsed ? ' collapsed' : ''}`}>
          <button
            type="button"
            className="graph-legend-toggle"
            aria-label={legendCollapsed ? '展开图例' : '收起图例'}
            onClick={() => setLegendCollapsed((collapsed) => !collapsed)}
          >
            {legendCollapsed ? <Info size={14} /> : <ChevronDown size={14} />}
          </button>
          {!legendCollapsed && (
            <div className="graph-legend-items">
              <span className="graph-legend-item">
                <span className="graph-legend-dot" style={{ background: 'var(--graph-node-file)' }} />
                文档
              </span>
              <span className="graph-legend-item">
                <span className="graph-legend-line" style={{ background: 'var(--graph-edge)' }} />
                双向链接
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GraphView
