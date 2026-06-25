import { useState, useCallback, useRef } from 'react'
import type { TabDescriptor, FileTab, FixedTab } from '../../shared/types'
import { isFileTab } from '../../shared/types'
import { useAgentStore } from '../store/agent-store-impl'
import {
  createWorkspaceTabState,
  pendingSaveFor,
  visibleFileContent,
  withPendingSave,
  withSavedFile,
  withoutFilePrefixState,
  withoutFileState,
  type WorkspaceTabState,
} from './tab-save-state'

export type { TabDescriptor, FileTab, FixedTab }

export type SaveFileResult = { success: boolean; error?: string; pending?: boolean }

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
  const activeSessionId = useAgentStore((s) => s.activeSessionId.editor)
  const [workspaceStates, setWorkspaceStates] = useState<Record<string, WorkspaceTabState>>({})
  const workspaceStatesRef = useRef(workspaceStates)
  workspaceStatesRef.current = workspaceStates

  // Derive current composite key and state
  const currentKey = activeWorkspacePath ? compositeKey(activeWorkspacePath, activeSessionId) : null
  const currentState = currentKey ? workspaceStates[currentKey] : undefined
  const openTabs = currentState?.tabs ?? []
  const activeTab = currentState?.activeTab ?? null
  const tabContents = currentState?.tabContents ?? {}
  const pendingSaves = currentState?.pendingSaves ?? {}
  const activeFilePath = activeTab && isFileTab(activeTab) ? activeTab.path : ''
  const activePendingSave = activeFilePath ? pendingSaveFor(currentState, activeFilePath) : null

  // Helper to get the composite key from store at call time
  const getCurrentKey = useCallback((): string | null => {
    const state = useAgentStore.getState()
    if (!state.activeWorkspacePath) return null
    return compositeKey(state.activeWorkspacePath, state.activeSessionId.editor)
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
        const current = prev[key] ?? createWorkspaceTabState()
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
      const current = prev[key] ?? createWorkspaceTabState()
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
        const current = prev[key] ?? createWorkspaceTabState()
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
            pendingSaves: current.pendingSaves ?? {},
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
      return withoutFileState({ ...prev, tabs: nextTabs, activeTab: nextActive }, filePath)
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
        next[ws] = withoutFilePrefixState({ ...state, tabs: newTabs, activeTab: newActive }, prefix)
      }
      return next
    })
  }, [])

  const saveFile = useCallback(async (filePath: string, content: string): Promise<SaveFileResult> => {
    const key = getCurrentKey()
    if (!key) return { success: false, error: 'No active workspace', pending: false }

    let result: SaveFileResult
    try {
      result = await window.api.workspace.writeFile(filePath, content)
    } catch (err) {
      result = { success: false, error: (err as Error).message }
    }

    if (!result.success) {
      console.error('[useTabs] saveFile failed:', result.error || 'unknown error')
      const error = result.error || '保存失败'
      setWorkspaceStates(prev => {
        const current = prev[key] ?? createWorkspaceTabState()
        return { ...prev, [key]: withPendingSave(current, filePath, content, error) }
      })
      return { ...result, error, pending: true }
    }
    setWorkspaceStates(prev => {
      const current = prev[key] ?? createWorkspaceTabState()
      return { ...prev, [key]: withSavedFile(current, filePath, content) }
    })
    return result
  }, [getCurrentKey])

  const retryPendingSave = useCallback(async (filePath?: string): Promise<SaveFileResult> => {
    const key = getCurrentKey()
    if (!key) return { success: false, error: 'No active workspace', pending: false }

    const state = workspaceStatesRef.current[key]
    const targetPath = filePath || (state?.activeTab && isFileTab(state.activeTab) ? state.activeTab.path : '')
    if (!targetPath) return { success: false, error: 'No active file', pending: false }

    const pending = pendingSaveFor(state, targetPath)
    if (!pending) return { success: true }

    return saveFile(targetPath, pending.content)
  }, [getCurrentKey, saveFile])

  const refreshActiveContent = useCallback(async () => {
    if (!activeTab || !isFileTab(activeTab)) return
    const path = activeTab.path
    const result = await window.api.workspace.readFile(path)
    if (result.success && result.content !== undefined) {
      setCurrentWsState(prev => {
        if (prev.pendingSaves?.[path]) {
          return prev
        }
        if (prev.tabContents[path] !== result.content) {
          return withSavedFile(prev, path, result.content!)
        }
        return prev
      })
    }
  }, [activeTab, setCurrentWsState])

  const activeContent = activeFilePath
    ? visibleFileContent(currentState, activeFilePath)
    : ''

  const hasFileTab = useCallback((path: string) =>
    openTabs.some(t => isFileTab(t) && t.path === path),
    [openTabs])

  return {
    openTabs,
    activeTab,
    tabContents,
    pendingSaves,
    activeContent,
    activeFilePath,
    activeSaveError: activePendingSave?.error ?? null,
    activeHasPendingSave: Boolean(activePendingSave),
    openFile,
    openFixedTab,
    closeTab,
    switchTab,
    clearTab,
    closeTabsByPrefix,
    saveFile,
    retryPendingSave,
    refreshActiveContent,
    hasFileTab,
  }
}
