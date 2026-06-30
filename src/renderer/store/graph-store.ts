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
  changedFileVersion: number

  // UI state
  searchQuery: string
  showGraph: boolean

  // Actions
  setSearchQuery: (query: string) => void
  toggleGraph: () => void
  setShowGraph: (show: boolean) => void
  loadGraphData: () => Promise<void>
  handleFilesChanged: (data: { count: number; files: string[]; version: number }) => void
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
  changedFileVersion: 0,

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
      const loadedVersion = data.changeVersion || 0
      await window.api.graph.acknowledgeChanges(loadedVersion)
      set((state) => state.changedFileVersion > loadedVersion
        ? { graphData: data, filteredData: data }
        : {
            graphData: data,
            filteredData: data,
            changedFileCount: 0,
            changedFiles: [],
            changedFileVersion: loadedVersion,
          })
    } catch (err) {
      console.error('[GraphStore] Failed to load graph data:', err)
    }
  },

  handleFilesChanged: (data) => {
    set({ changedFileCount: data.count, changedFiles: data.files, changedFileVersion: data.version })
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
