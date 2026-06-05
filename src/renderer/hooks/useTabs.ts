import { useState, useCallback, useEffect } from 'react'

/**
 * Tab controller — open/close/switch/save for the editor tab bar.
 *
 * Manages the lifecycle of open editor tabs: which files are open,
 * which is active, and their in-memory content buffers.
 */
export function useTabs() {
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [tabContents, setTabContents] = useState<Record<string, string>>({})

  /** Open a file in a new tab. Reads content via IPC. */
  const openFile = useCallback(async (filePath: string): Promise<boolean> => {
    // Already open — just switch
    if (openTabs.includes(filePath)) {
      setActiveTab(filePath)
      return true
    }

    const result = await window.api.workspace.readFile(filePath)
    if (result.success && result.content !== undefined) {
      setOpenTabs((prev) => [...prev, filePath])
      setActiveTab(filePath)
      setTabContents((prev) => ({ ...prev, [filePath]: result.content! }))
      return true
    }
    return false
  }, [openTabs])

  const closeTab = useCallback((filePath: string) => {
    const closedIdx = openTabs.indexOf(filePath)
    const nextTabs = openTabs.filter((t) => t !== filePath)
    const nextActive = filePath === activeTab
      ? (nextTabs[Math.min(closedIdx, nextTabs.length - 1)] || '')
      : activeTab

    setOpenTabs(nextTabs)
    if (nextActive !== activeTab) setActiveTab(nextActive)
    setTabContents((prev) => {
      const next = { ...prev }
      delete next[filePath]
      return next
    })
  }, [openTabs, activeTab])

  const switchTab = useCallback((filePath: string) => {
    setActiveTab(filePath)
  }, [])

  const clearTab = useCallback(() => {
    setActiveTab('')
  }, [])

  /** Close all tabs whose path starts with the given prefix (e.g. when deleting a workspace). */
  const closeTabsByPrefix = useCallback((prefix: string) => {
    setOpenTabs((prev) => prev.filter((t) => !t.startsWith(prefix)))
    setActiveTab((prev) => prev.startsWith(prefix) ? '' : prev)
    setTabContents((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) delete next[key]
      }
      return next
    })
  }, [])

  const saveFile = useCallback(async (filePath: string, content: string) => {
    await window.api.workspace.writeFile(filePath, content)
    setTabContents((prev) => ({ ...prev, [filePath]: content }))
  }, [])

  /** Re-read the active tab's content from disk (after agent modifications). */
  const refreshActiveContent = useCallback(async () => {
    if (!activeTab) return
    const result = await window.api.workspace.readFile(activeTab)
    if (result.success && result.content !== undefined) {
      setTabContents((prev) => {
        if (prev[activeTab] !== result.content) {
          return { ...prev, [activeTab]: result.content! }
        }
        return prev
      })
    }
  }, [activeTab])

  const activeContent = activeTab ? tabContents[activeTab] || '' : ''

  return {
    openTabs,
    activeTab,
    tabContents,
    activeContent,
    openFile,
    closeTab,
    switchTab,
    clearTab,
    closeTabsByPrefix,
    saveFile,
    refreshActiveContent,
  }
}
