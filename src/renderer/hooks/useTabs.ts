import { useState, useCallback, useRef } from 'react'
import type { TabDescriptor, FileTab, FixedTab } from '../../shared/types'
import { isFileTab } from '../../shared/types'
import { useAgentStore } from '../store/agent-store-impl'

export type { TabDescriptor, FileTab, FixedTab }

type WorkspaceTabState = {
  tabs: TabDescriptor[]
  activeTab: TabDescriptor | null
  tabContents: Record<string, string>
}

// Composite key from workspace path + session ID
function compositeKey(ws: string, sid: string | null): string {
  return `${ws}::${sid ?? ''}`
}

/**
 * Tab controller with per-session isolation.
 * Each (workspace, session) pair stores its own open tabs.
 * Switching workspace or session saves current state and loads the target's state.
 */
export function useTabs() {
  const activeWorkspacePath = useAgentStore((s) => s.activeWorkspacePath)
  const activeSessionId = useAgentStore((s) => s.activeSessionId)
  const [workspaceStates, setWorkspaceStates] = useState<Record<string, WorkspaceTabState>>({})
  const workspaceStatesRef = useRef(workspaceStates)
  workspaceStatesRef.current = workspaceStates

  // Derive current composite key and state
  const currentKey = activeWorkspacePath ? compositeKey(activeWorkspacePath, activeSessionId) : null
  const currentState = currentKey ? workspaceStates[currentKey] : undefined
  const openTabs = currentState?.tabs ?? []
  const activeTab = currentState?.activeTab ?? null
  const tabContents = currentState?.tabContents ?? {}

  // Helper to get the composite key from store at call time
  const getCurrentKey = useCallback((): string | null => {
    const state = useAgentStore.getState()
    if (!state.activeWorkspacePath) return null
    return compositeKey(state.activeWorkspacePath, state.activeSessionId)
  }, [])

  // Helper to update the current composite-key entry.
  // Reads activeWorkspacePath + activeSessionId from the Zustand store
  // directly (not from the hook closure) so that callers who mutate the
  // store synchronously before React re-renders (e.g. handleFileSelect
  // calling setActiveWorkspace then openFile in the same event handler)
  // always target the correct (workspace, session) pair.
  const setCurrentWsState = useCallback(
    (updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
      const key = getCurrentKey()
      if (!key) return
      setWorkspaceStates(prev => {
        const current = prev[key] ?? { tabs: [], activeTab: null, tabContents: {} }
        return { ...prev, [key]: updater(current) }
      })
    },
    [getCurrentKey],
  )

  const openFile = useCallback(async (filePath: string): Promise<boolean> => {
    // Capture composite key at call time to prevent async race conditions
    const key = getCurrentKey()
    if (!key) return false

    // Dedup check inside the updater to prevent race-condition duplicates
    let alreadyOpen = false
    setWorkspaceStates(prev => {
      const current = prev[key] ?? { tabs: [], activeTab: null, tabContents: {} }
      if (current.tabs.some(t => isFileTab(t) && t.path === filePath)) {
        alreadyOpen = true
        return { ...prev, [key]: { ...current, activeTab: { type: 'file', path: filePath } } }
      }
      return prev
    })
    if (alreadyOpen) return true

    const result = await window.api.workspace.readFile(filePath)
    if (result.success && result.content !== undefined) {
      setWorkspaceStates(prev => {
        const current = prev[key] ?? { tabs: [], activeTab: null, tabContents: {} }
        // Re-check dedup after async read
        if (current.tabs.some(t => isFileTab(t) && t.path === filePath)) {
          return { ...prev, [key]: { ...current, activeTab: { type: 'file', path: filePath } } }
        }
        return {
          ...prev,
          [key]: {
            tabs: [...current.tabs, { type: 'file', path: filePath }],
            activeTab: { type: 'file', path: filePath },
            tabContents: { ...current.tabContents, [filePath]: result.content! },
          },
        }
      })
      return true
    }
    return false
  }, [getCurrentKey])

  const openFixedTab = useCallback((tabId: string, _workspacePath?: string) => {
    setCurrentWsState(prev => {
      const existing = prev.tabs.find(t => t.type === 'fixed' && t.id === tabId)
      if (!existing) {
        const newTab: FixedTab = { type: 'fixed', id: tabId }
        return { ...prev, tabs: [newTab, ...prev.tabs], activeTab: newTab }
      }
      return { ...prev, activeTab: { type: 'fixed', id: tabId } }
    })
  }, [setCurrentWsState])

  const closeTab = useCallback((tab: TabDescriptor) => {
    if (tab.type === 'fixed') return

    const filePath = tab.path
    setCurrentWsState(prev => {
      const closedIdx = prev.tabs.findIndex(t => isFileTab(t) && t.path === filePath)
      const nextTabs = prev.tabs.filter(t => !(isFileTab(t) && t.path === filePath))
      let nextActive: TabDescriptor | null = prev.activeTab
      if (prev.activeTab && isFileTab(prev.activeTab) && prev.activeTab.path === filePath) {
        nextActive = nextTabs.length > 0 ? nextTabs[Math.min(closedIdx, nextTabs.length - 1)] : null
      }
      const nextContents = { ...prev.tabContents }
      delete nextContents[filePath]
      return { tabs: nextTabs, activeTab: nextActive, tabContents: nextContents }
    })
  }, [setCurrentWsState])

  const switchTab = useCallback((tab: TabDescriptor) => {
    setCurrentWsState(prev => ({ ...prev, activeTab: tab }))
  }, [setCurrentWsState])

  const clearTab = useCallback(() => {
    setCurrentWsState(prev => ({ ...prev, activeTab: null }))
  }, [setCurrentWsState])

  const closeTabsByPrefix = useCallback((prefix: string) => {
    setWorkspaceStates(prev => {
      const next = { ...prev }
      for (const [ws, state] of Object.entries(next)) {
        const newTabs = state.tabs.filter(t => !(isFileTab(t) && t.path.startsWith(prefix)))
        if (newTabs.length === state.tabs.length) continue
        const newActive = (state.activeTab && isFileTab(state.activeTab) && state.activeTab.path.startsWith(prefix))
          ? null : state.activeTab
        const newContents = { ...state.tabContents }
        for (const key of Object.keys(newContents)) {
          if (key.startsWith(prefix)) delete newContents[key]
        }
        next[ws] = { tabs: newTabs, activeTab: newActive, tabContents: newContents }
      }
      return next
    })
  }, [])

  const saveFile = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
    setCurrentWsState(prev => ({
      ...prev,
      tabContents: { ...prev.tabContents, [filePath]: content },
    }))
  }, [setCurrentWsState])

  const refreshActiveContent = useCallback(async () => {
    if (!activeTab || !isFileTab(activeTab)) return
    const path = activeTab.path
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content !== undefined) {
      setCurrentWsState(prev => {
        if (prev.tabContents[path] !== result.content) {
          return { ...prev, tabContents: { ...prev.tabContents, [path]: result.content! } }
        }
        return prev
      })
    }
  }, [activeTab, setCurrentWsState])

  const activeContent = (activeTab && isFileTab(activeTab))
    ? (tabContents[activeTab.path] || '')
    : ''

  const activeFilePath = activeTab && isFileTab(activeTab) ? activeTab.path : ''
  const hasFileTab = useCallback((path: string) =>
    openTabs.some(t => isFileTab(t) && t.path === path),
    [openTabs])

  return {
    openTabs,
    activeTab,
    tabContents,
    activeContent,
    activeFilePath,
    openFile,
    openFixedTab,
    closeTab,
    switchTab,
    clearTab,
    closeTabsByPrefix,
    saveFile,
    refreshActiveContent,
    hasFileTab,
  }
}
