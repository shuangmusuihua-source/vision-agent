import { useEffect, useRef, useState, useCallback } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide
} from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum, Simulation } from 'd3-force'
import { select } from 'd3-selection'
import { zoom } from 'd3-zoom'
import { drag } from 'd3-drag'
import type { GraphNode, GraphEdge } from '../../lib/ipc'

interface GraphViewProps {
  onNodeClick: (nodeId: string) => void
}

interface SimNode extends SimulationNodeDatum {
  id: string
  label: string
  type: 'file' | 'memory'
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: SimNode | string
  target: SimNode | string
}

const FILE_COLOR = '#2383e2'
const MEMORY_COLOR = '#7c3aed'

function GraphView({ onNodeClick }: GraphViewProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())

  const handleResize = useCallback(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect()
      setDimensions({ width, height })
    }
  }, [])

  useEffect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  // Search highlighting
  useEffect(() => {
    if (!svgRef.current) return
    const svg = select(svgRef.current)
    const nodes = svg.selectAll<SVGGElement, SimNode>('g[cursor="pointer"]')

    nodes.select('circle')
      .attr('r', (d) => highlightedIds.has(d.id) ? 26 : 20)
      .attr('stroke-width', (d) => highlightedIds.has(d.id) ? 3 : 2)
      .attr('stroke', (d) => highlightedIds.has(d.id) ? '#f59e0b' : 'var(--color-bg-primary)')

    nodes.select('text')
      .attr('fill', (d) => highlightedIds.has(d.id) ? '#f59e0b' : 'var(--color-text-secondary)')
      .attr('font-weight', (d) => highlightedIds.has(d.id) ? 'bold' : 'normal')
  }, [highlightedIds])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setHighlightedIds(new Set())
      return
    }
    window.api.graph.getData().then(({ nodes }) => {
      const q = searchQuery.toLowerCase()
      const ids = new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id))
      setHighlightedIds(ids)
    }).catch(() => setHighlightedIds(new Set()))
  }, [searchQuery])

  // Build graph
  useEffect(() => {
    if (!svgRef.current) return

    window.api.graph.getData().then(({ nodes, edges }) => {
      if (!svgRef.current) return

      const svg = select(svgRef.current)
      svg.selectAll('*').remove()

      if (nodes.length === 0) {
        svg.append('text')
          .attr('x', dimensions.width / 2)
          .attr('y', dimensions.height / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--color-text-tertiary)')
          .text('No files found')
        return
      }

      const simNodes: SimNode[] = nodes.map((n) => ({ ...n }))
      const nodeMap = new Map(simNodes.map((n) => [n.id, n]))
      const simEdges: SimEdge[] = edges
        .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
        .map((e) => ({ source: e.source, target: e.target }))

      const g = svg.append('g')

      // Zoom
      const zoomBehavior = zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform)
        })
      svg.call(zoomBehavior)

      // Simulation
      const simulation = forceSimulation<SimNode>(simNodes)
        .force('link', forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(120))
        .force('charge', forceManyBody().strength(-300))
        .force('center', forceCenter(dimensions.width / 2, dimensions.height / 2))
        .force('collision', forceCollide().radius(40))
      simulationRef.current = simulation

      // Edges
      const link = g.append('g')
        .selectAll('line')
        .data(simEdges)
        .join('line')
        .attr('stroke', 'var(--color-border)')
        .attr('stroke-width', 1.5)

      // Nodes
      const node = g.append('g')
        .selectAll<SVGGElement, SimNode>('g')
        .data(simNodes)
        .join('g')
        .attr('cursor', 'pointer')
        .call(drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          })
        )

      node.append('circle')
        .attr('r', 20)
        .attr('fill', (d) => d.type === 'memory' ? MEMORY_COLOR : FILE_COLOR)
        .attr('stroke', 'var(--color-bg-primary)')
        .attr('stroke-width', 2)

      node.append('text')
        .text((d) => d.label)
        .attr('dy', 32)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--color-text-secondary)')
        .attr('font-size', 11)
        .each(function (d) {
          const text = select(this)
          if (d.label.length > 12) {
            text.text(d.label.substring(0, 11) + '…')
          }
        })

      // Hover tooltip
      node.on('mouseenter', (event, d) => {
        if (tooltipRef.current) {
          tooltipRef.current.textContent = d.label
          tooltipRef.current.style.display = 'block'
          tooltipRef.current.style.left = `${event.offsetX + 10}px`
          tooltipRef.current.style.top = `${event.offsetY + 10}px`
        }
        select(event.currentTarget).select('circle')
          .transition().duration(150)
          .attr('r', 24)
          .attr('stroke-width', 3)
      })

      node.on('mouseleave', (event) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none'
        }
        select(event.currentTarget).select('circle')
          .transition().duration(150)
          .attr('r', 20)
          .attr('stroke-width', 2)
      })

      node.on('click', (_event, d) => {
        onNodeClick(d.id)
      })

      // Tick
      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as SimNode).x!)
          .attr('y1', (d) => (d.source as SimNode).y!)
          .attr('x2', (d) => (d.target as SimNode).x!)
          .attr('y2', (d) => (d.target as SimNode).y!)

        node.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })
    }).catch(console.error)

    return () => {
      simulationRef.current?.stop()
      simulationRef.current = null
    }
  }, [dimensions, onNodeClick])

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
        <div className="graph-legend">
          <span className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: FILE_COLOR }} />
            File
          </span>
          <span className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: MEMORY_COLOR }} />
            Memory
          </span>
        </div>
      </div>
      <div className="graph-canvas">
        <svg ref={svgRef} width={dimensions.width} height={dimensions.height} />
        <div ref={tooltipRef} className="graph-tooltip" style={{ display: 'none' }} />
      </div>
    </div>
  )
}

export default GraphView