import { create } from 'zustand'
import type { GraphData } from '../../shared/types'

// ─── Graph Store ────────────────────────────────────────────────────

export type GraphStore = {
  // Core data
  graphData: GraphData
  filteredData: GraphData

  // File change tracking
  changedFileCount: number
  changedFiles: string[]

  // UI state
  searchQuery: string
  showGraph: boolean

  // Actions
  setSearchQuery: (query: string) => void
  toggleGraph: () => void
  setShowGraph: (show: boolean) => void
  loadGraphData: () => Promise<void>
  handleFilesChanged: (data: { count: number; files: string[] }) => void
  clearChangedFiles: () => void
}

// ─── Store implementation ───────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set) => ({
  // Core data
  graphData: { nodes: [], edges: [] },
  filteredData: { nodes: [], edges: [] },

  // File change tracking
  changedFileCount: 0,
  changedFiles: [],

  // UI state
  searchQuery: '',
  showGraph: false,

  // ─── Actions ─────────────────────────────────────────────────────

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
      set({ graphData: data, filteredData: data, changedFileCount: 0, changedFiles: [] })
    } catch (err) {
      console.error('[GraphStore] Failed to load graph data:', err)
    }
  },

  handleFilesChanged: (data) => {
    set({ changedFileCount: data.count, changedFiles: data.files })
  },

  clearChangedFiles: () => {
    set({ changedFileCount: 0, changedFiles: [] })
  },
}))

// ─── Selectors ──────────────────────────────────────────────────────

export const useGraphData = () => useGraphStore(s => s.filteredData)
export const useChangedFileCount = () => useGraphStore(s => s.changedFileCount)
export const useGraphSearchQuery = () => useGraphStore(s => s.searchQuery)
export const useShowGraph = () => useGraphStore(s => s.showGraph)
