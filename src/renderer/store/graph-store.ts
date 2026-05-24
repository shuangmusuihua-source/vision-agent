import { create } from 'zustand'
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphExtractionState,
  GraphExtractionProgress,
  GraphExtractionEvent,
  FilterMode,
} from '../../shared/types'

// ─── Graph Store ────────────────────────────────────────────────────

export type GraphStore = {
  // Core data
  graphData: GraphData
  filteredData: GraphData

  // Extraction state machine
  extractionState: GraphExtractionState
  extractionProgress: GraphExtractionProgress | null

  // File change tracking
  changedFileCount: number
  changedFiles: string[]

  // UI state
  filter: FilterMode
  searchQuery: string
  showGraph: boolean

  // Actions
  dispatchExtractionEvent: (event: GraphExtractionEvent) => void
  setFilter: (filter: FilterMode) => void
  setSearchQuery: (query: string) => void
  toggleGraph: () => void
  setShowGraph: (show: boolean) => void
  loadGraphData: () => Promise<void>
  startExtraction: () => Promise<void>
  handleFilesChanged: (data: { count: number; files: string[] }) => void
  clearChangedFiles: () => void
  setExtractionProgress: (progress: GraphExtractionProgress | null) => void
}

// ─── State machine transitions ──────────────────────────────────────

const transitions: Record<GraphExtractionState, Partial<Record<GraphExtractionEvent['type'], GraphExtractionState>>> = {
  idle:      { EXTRACT_START: 'indexing' },
  indexing:  { INDEX_DONE: 'extracting', NO_CHANGES: 'complete', EXTRACT_ERROR: 'error' },
  extracting: { BATCH_PROGRESS: 'extracting', ALL_BATCHES_DONE: 'merging', EXTRACT_ERROR: 'error', ABORT: 'idle' },
  merging:   { MERGE_DONE: 'complete', EXTRACT_ERROR: 'error' },
  complete:  { AUTO_RESET: 'idle', EXTRACT_START: 'indexing' },
  error:     { EXTRACT_START: 'indexing' },
}

// ─── Filter logic ───────────────────────────────────────────────────

function applyFilter(data: GraphData, filter: FilterMode): GraphData {
  if (filter === 'all') return data

  const nodeSet = new Set<string>()

  if (filter === 'reference') {
    // file + memory nodes
    for (const n of data.nodes) {
      if (n.type === 'file' || n.type === 'memory') nodeSet.add(n.id)
    }
    // anchor edges: keep semantic edges that connect to file/memory nodes
    const edgeSet = new Set<string>()
    const filteredEdges: GraphEdge[] = []
    for (const e of data.edges) {
      if (e.type === 'reference') {
        if (nodeSet.has(e.source) && nodeSet.has(e.target)) {
          filteredEdges.push(e)
        }
      } else if (e.type === 'semantic') {
        // anchor edge: connects entity to file
        const srcIsFile = nodeSet.has(e.source)
        const tgtIsFile = nodeSet.has(e.target)
        if (srcIsFile || tgtIsFile) {
          // add the entity node too
          const entityNodeId = srcIsFile ? e.target : e.source
          const entityNode = data.nodes.find(n => n.id === entityNodeId)
          if (entityNode) {
            nodeSet.add(entityNode.id)
            filteredEdges.push(e)
          }
        }
      }
    }
    return {
      nodes: data.nodes.filter(n => nodeSet.has(n.id)),
      edges: filteredEdges,
    }
  }

  if (filter === 'semantic') {
    // entity nodes
    for (const n of data.nodes) {
      if (n.type === 'entity') nodeSet.add(n.id)
    }
    // anchor edges: keep semantic edges that connect entity to file/memory nodes
    const filteredEdges: GraphEdge[] = []
    for (const e of data.edges) {
      if (e.type === 'semantic') {
        // keep if at least one end is an entity
        const srcIsEntity = nodeSet.has(e.source)
        const tgtIsEntity = nodeSet.has(e.target)
        if (srcIsEntity || tgtIsEntity) {
          // add the non-entity node if it's an anchor
          if (!srcIsEntity) {
            const fileNode = data.nodes.find(n => n.id === e.source)
            if (fileNode) nodeSet.add(fileNode.id)
          }
          if (!tgtIsEntity) {
            const fileNode = data.nodes.find(n => n.id === e.target)
            if (fileNode) nodeSet.add(fileNode.id)
          }
          filteredEdges.push(e)
        }
      }
    }
    return {
      nodes: data.nodes.filter(n => nodeSet.has(n.id)),
      edges: filteredEdges,
    }
  }

  return data
}

// ─── Store implementation ───────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set, get) => ({
  // Core data
  graphData: { nodes: [], edges: [] },
  filteredData: { nodes: [], edges: [] },

  // Extraction state machine
  extractionState: 'idle',
  extractionProgress: null,

  // File change tracking
  changedFileCount: 0,
  changedFiles: [],

  // UI state
  filter: 'all',
  searchQuery: '',
  showGraph: false,

  // ─── Actions ─────────────────────────────────────────────────────

  dispatchExtractionEvent: (event) => {
    const state = get()
    const current = state.extractionState
    const next = transitions[current]?.[event.type]
    if (!next && !(event.type === 'BATCH_PROGRESS' && current === 'extracting')) {
      console.warn(`[GraphStore] Invalid transition: ${current} + ${event.type}`)
      return
    }
    const updates: Partial<GraphStore> = {}

    if (next) updates.extractionState = next

    if (event.type === 'BATCH_PROGRESS') {
      updates.extractionProgress = {
        phase: 'extracting',
        progress: event.totalBatches > 0 ? event.currentBatch / event.totalBatches : 0,
        currentBatch: event.currentBatch,
        totalBatches: event.totalBatches,
      }
    }

    if (event.type === 'NO_CHANGES') {
      updates.extractionProgress = null
    }

    if (event.type === 'MERGE_DONE') {
      updates.extractionProgress = null
    }

    if (event.type === 'EXTRACT_ERROR') {
      updates.extractionProgress = null
    }

    if (event.type === 'AUTO_RESET') {
      updates.extractionProgress = null
    }

    set(updates)

    // Auto-reset from 'complete' after 3 seconds
    if (next === 'complete') {
      setTimeout(() => {
        if (get().extractionState === 'complete') {
          get().dispatchExtractionEvent({ type: 'AUTO_RESET' })
        }
      }, 3000)
    }
  },

  setFilter: (filter) => {
    const { graphData } = get()
    set({ filter, filteredData: applyFilter(graphData, filter) })
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  toggleGraph: () => {
    set(s => ({ showGraph: !s.showGraph }))
  },

  setShowGraph: (show) => {
    set({ showGraph: show })
  },

  loadGraphData: async () => {
    try {
      const data = await window.api.graph.getData()
      const { filter } = get()
      set({ graphData: data, filteredData: applyFilter(data, filter) })
    } catch (err) {
      console.error('[GraphStore] Failed to load graph data:', err)
    }
  },

  startExtraction: async () => {
    const state = get()
    if (state.extractionState !== 'idle' && state.extractionState !== 'complete' && state.extractionState !== 'error') {
      return
    }
    state.dispatchExtractionEvent({ type: 'EXTRACT_START' })

    try {
      const result = await window.api.graph.extractSemantic()

      if (result.skipped) {
        state.dispatchExtractionEvent({ type: 'NO_CHANGES' })
        return
      }

      if (!result.success) {
        state.dispatchExtractionEvent({ type: 'EXTRACT_ERROR', error: result.error || 'Unknown error' })
        return
      }

      state.dispatchExtractionEvent({ type: 'ALL_BATCHES_DONE' })

      // Reload merged graph data
      await get().loadGraphData()

      state.dispatchExtractionEvent({ type: 'MERGE_DONE' })
    } catch (err: any) {
      state.dispatchExtractionEvent({ type: 'EXTRACT_ERROR', error: err.message || String(err) })
    }
  },

  handleFilesChanged: (data) => {
    set({ changedFileCount: data.count, changedFiles: data.files })
  },

  clearChangedFiles: () => {
    set({ changedFileCount: 0, changedFiles: [] })
  },

  setExtractionProgress: (progress) => {
    set({ extractionProgress: progress })
  },
}))

// ─── Selectors ──────────────────────────────────────────────────────

export const useGraphData = () => useGraphStore(s => s.filteredData)
export const useExtractionState = () => useGraphStore(s => s.extractionState)
export const useExtractionProgress = () => useGraphStore(s => s.extractionProgress)
export const useChangedFileCount = () => useGraphStore(s => s.changedFileCount)
export const useGraphFilter = () => useGraphStore(s => s.filter)
export const useGraphSearchQuery = () => useGraphStore(s => s.searchQuery)
export const useShowGraph = () => useGraphStore(s => s.showGraph)
