import { useState, useCallback, useEffect, useRef } from 'react'
import { filterUserWorkspacePaths, KNOWLEDGE_BASE_NAME } from '../../shared/workspace-paths'

/**
 * Workspace management — paths and CRUD modals.
 *
 * Keeps workspace-level state and modals in one place. File discovery is
 * handled by the search/index modules rather than duplicated in renderer state.
 */
export function useWorkspace() {
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [fixedWorkspacePaths, setFixedWorkspacePaths] = useState<string[]>([])

  // Knowledge base dir
  useEffect(() => {
    window.api.workspace.knowledgeDir().then(dir => {
      setFixedWorkspacePaths([dir])
      setWorkspacePaths((prev) => filterUserWorkspacePaths(prev, [dir]))
    })
  }, [])

  // ── Settings sync ──────────────────────────────────────────────────

  const prevAuthDirsRef = useRef<string>('')

  /** Pull workspace directories from cached settings on change. */
  function syncFromSettings(dirs: string[], fixedDirs: string[] = fixedWorkspacePaths): void {
    const userDirs = filterUserWorkspacePaths(dirs, fixedDirs)
    const key = `${userDirs.join(',')}::${fixedDirs.join(',')}`
    if (key === prevAuthDirsRef.current) return
    prevAuthDirsRef.current = key
    setWorkspacePaths(userDirs)
  }

  // ── Workspace-level handlers ──────────────────────────────────────

  const handleReorderWorkspaces = useCallback(async (paths: string[]) => {
    const userPaths = filterUserWorkspacePaths(paths, fixedWorkspacePaths)
    setWorkspacePaths(userPaths)
    await window.api.settings.reorderDirectories(userPaths)
  }, [fixedWorkspacePaths])

  const handleRemoveWorkspace = useCallback((path: string) => {
    setDeleteWsPath(path)
    setDeleteWsConfirm('')
  }, [])

  // ── New workspace modal ────────────────────────────────────────────

  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceError, setNewWorkspaceError] = useState('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)

  const handleOpenNewWorkspaceModal = useCallback(() => {
    setNewWorkspaceName('')
    setNewWorkspaceError('')
    setShowNewWorkspaceModal(true)
    requestAnimationFrame(() => setModalVisible(true))
  }, [])

  const handleCloseNewWorkspaceModal = useCallback(() => {
    setModalVisible(false)
    setTimeout(() => {
      setShowNewWorkspaceModal(false)
      setNewWorkspaceName('')
      setNewWorkspaceError('')
      setIsCreatingWorkspace(false)
    }, 200)
  }, [])

  const handleCreateWorkspace = useCallback(async () => {
    const name = newWorkspaceName.trim()
    if (!name) {
      setNewWorkspaceError('请输入工作区名称')
      return
    }
    if (name === KNOWLEDGE_BASE_NAME) {
      setNewWorkspaceError('Knowledge 是系统保留工作区名称')
      return
    }
    if (/[/\\]/.test(name) || name.includes('..')) {
      setNewWorkspaceError('工作区名称不能包含 / \\ 或 ..')
      return
    }
    setIsCreatingWorkspace(true)
    setNewWorkspaceError('')
    try {
      const dirPath = await window.api.workspace.createWorkspace(name)
      if (dirPath) {
        if (!workspacePaths.includes(dirPath)) {
          setWorkspacePaths((prev) => [...prev, dirPath])
          await window.api.settings.addDirectory(dirPath)
        }
        handleCloseNewWorkspaceModal()
      } else {
        setNewWorkspaceError('工作区已存在，请使用其他名称')
      }
    } catch {
      setNewWorkspaceError('创建工作区失败，请重试')
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [newWorkspaceName, workspacePaths, handleCloseNewWorkspaceModal])

  // ── Delete workspace modal ─────────────────────────────────────────

  const [deleteWsPath, setDeleteWsPath] = useState<string | null>(null)
  const [deleteWsConfirm, setDeleteWsConfirm] = useState('')

  const handleDeleteWorkspace = useCallback(async () => {
    if (!deleteWsPath) return { success: false }
    const result = await window.api.workspace.deleteWorkspace(deleteWsPath)
    if (result.success) {
      setWorkspacePaths((prev) => prev.filter((p) => p !== deleteWsPath))
      setDeleteWsPath(null)
    }
    return result
  }, [deleteWsPath])

  return {
    // State
    workspacePaths,
    setWorkspacePaths,
    fixedWorkspacePaths,
    // Settings
    syncFromSettings,
    // Workspace handlers
    handleReorderWorkspaces,
    handleRemoveWorkspace,
    // New workspace modal
    showNewWorkspaceModal,
    modalVisible,
    newWorkspaceName,
    setNewWorkspaceName,
    newWorkspaceError,
    setNewWorkspaceError,
    isCreatingWorkspace,
    handleOpenNewWorkspaceModal,
    handleCloseNewWorkspaceModal,
    handleCreateWorkspace,
    // Delete workspace modal
    deleteWsPath,
    setDeleteWsPath,
    deleteWsConfirm,
    setDeleteWsConfirm,
    handleDeleteWorkspace,
  }
}
