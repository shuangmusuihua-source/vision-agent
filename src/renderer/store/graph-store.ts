import { create } from 'zustand'
import type { GraphData } from '../../shared/types'

// ─── Graph Store ────────────────────────────────────────────────────

export type GraphStore = {
  // Core data
  graphData: GraphData

  // File change tracking
  changedFileCount: number
  changedFiles: string[]
  changedFileVersion: number
  isLoading: boolean
  error: string | null

  // Actions
  loadGraphData: () => Promise<void>
  handleFilesChanged: (data: { count: number; files: string[]; version: number }) => void
  clearChangedFiles: () => void
}

// ─── Store implementation ───────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set) => ({
  // Core data
  graphData: { nodes: [], edges: [] },

  // File change tracking
  changedFileCount: 0,
  changedFiles: [],
  changedFileVersion: 0,
  isLoading: false,
  error: null,

  // ─── Actions ─────────────────────────────────────────────────────

  loadGraphData: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await window.api.graph.getData()
      const loadedVersion = data.changeVersion || 0
      await window.api.graph.acknowledgeChanges(loadedVersion)
      set((state) => state.changedFileVersion > loadedVersion
        ? { graphData: data, isLoading: false, error: null }
        : {
            graphData: data,
            changedFileCount: 0,
            changedFiles: [],
            changedFileVersion: loadedVersion,
            isLoading: false,
            error: null,
          })
    } catch (err) {
      console.error('[GraphStore] Failed to load graph data:', err)
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '无法读取知识库数据',
      })
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

export const useGraphData = () => useGraphStore(s => s.graphData)
export const useChangedFileCount = () => useGraphStore(s => s.changedFileCount)
