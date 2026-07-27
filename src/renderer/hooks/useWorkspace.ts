import { useState, useCallback, useEffect, useRef } from 'react'
import {
  appendUserWorkspacePath,
  filterUserWorkspacePaths,
  KNOWLEDGE_BASE_NAME,
  removeUserWorkspacePath,
} from '../../shared/workspace-paths'
import type { WorkspaceDeleteResult } from '../../shared/workspace-lifecycle'

export interface WorkspaceDialogsController {
  create: {
    open: boolean
    visible: boolean
    name: string
    error: string
    pending: boolean
    setName: (name: string) => void
    close: () => void
    submit: () => Promise<void>
  }
  remove: {
    path: string | null
    confirmation: string
    pending: boolean
    setConfirmation: (value: string) => void
    close: () => void
    submit: () => Promise<WorkspaceDeleteResult>
  }
}

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
    try {
      const result = await window.api.settings.reorderDirectories(userPaths)
      setWorkspacePaths(result.workspacePaths)
    } catch {
      setWorkspacePaths(workspacePaths)
    }
  }, [fixedWorkspacePaths, workspacePaths])

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
  const createInFlightRef = useRef<Promise<void> | null>(null)

  const handleOpenNewWorkspaceModal = useCallback(() => {
    setNewWorkspaceName('')
    setNewWorkspaceError('')
    setShowNewWorkspaceModal(true)
    requestAnimationFrame(() => setModalVisible(true))
  }, [])

  const handleCloseNewWorkspaceModal = useCallback(() => {
    if (createInFlightRef.current) return
    setModalVisible(false)
    setTimeout(() => {
      setShowNewWorkspaceModal(false)
      setNewWorkspaceName('')
      setNewWorkspaceError('')
      setIsCreatingWorkspace(false)
    }, 200)
  }, [])

  const handleNewWorkspaceNameChange = useCallback((name: string) => {
    setNewWorkspaceName(name)
    setNewWorkspaceError('')
  }, [])

  const handleCreateWorkspace = useCallback((): Promise<void> => {
    if (createInFlightRef.current) return createInFlightRef.current
    const name = newWorkspaceName.trim()
    if (!name) {
      setNewWorkspaceError('请输入工作区名称')
      return Promise.resolve()
    }
    if (name === KNOWLEDGE_BASE_NAME) {
      setNewWorkspaceError('Knowledge 是系统保留工作区名称')
      return Promise.resolve()
    }
    if (/[/\\]/.test(name) || name.includes('..')) {
      setNewWorkspaceError('工作区名称不能包含 / \\ 或 ..')
      return Promise.resolve()
    }

    const operation = (async () => {
      setIsCreatingWorkspace(true)
      setNewWorkspaceError('')
      try {
        const result = await window.api.workspace.createWorkspace(name)
        setWorkspacePaths(result.workspacePaths)
        if (result.success) {
          // Keep this merge idempotent when settings:changed arrives first.
          setWorkspacePaths((prev) => appendUserWorkspacePath(
            prev,
            result.workspacePath,
            fixedWorkspacePaths,
          ))
          setModalVisible(false)
          setTimeout(() => {
            setShowNewWorkspaceModal(false)
            setNewWorkspaceName('')
            setNewWorkspaceError('')
          }, 200)
        } else {
          setNewWorkspaceError(result.error)
        }
      } catch {
        setNewWorkspaceError('创建工作区失败，请重试')
      } finally {
        setIsCreatingWorkspace(false)
      }
    })()
    createInFlightRef.current = operation
    const clearCreation = () => {
      if (createInFlightRef.current === operation) createInFlightRef.current = null
    }
    void operation.then(clearCreation, clearCreation)
    return operation
  }, [newWorkspaceName, fixedWorkspacePaths])

  // ── Delete workspace modal ─────────────────────────────────────────

  const [deleteWsPath, setDeleteWsPath] = useState<string | null>(null)
  const [deleteWsConfirm, setDeleteWsConfirm] = useState('')
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const deleteInFlightRef = useRef<Promise<WorkspaceDeleteResult> | null>(null)

  const handleCloseDeleteWorkspace = useCallback(() => {
    if (deleteInFlightRef.current) return
    setDeleteWsPath(null)
    setDeleteWsConfirm('')
  }, [])

  const handleDeleteWorkspace = useCallback((): Promise<WorkspaceDeleteResult> => {
    if (deleteInFlightRef.current) return deleteInFlightRef.current
    if (!deleteWsPath) {
      return Promise.resolve({
        success: false,
        code: 'not_registered',
        error: '未选择工作区',
        workspacePaths,
      })
    }

    const deletingPath = deleteWsPath
    const operation = (async (): Promise<WorkspaceDeleteResult> => {
      setIsDeletingWorkspace(true)
      try {
        const result = await window.api.workspace.deleteWorkspace(deletingPath)
        setWorkspacePaths(result.workspacePaths)
        if (result.success) {
          setWorkspacePaths((prev) => removeUserWorkspacePath(
            prev,
            deletingPath,
            fixedWorkspacePaths,
          ))
          setDeleteWsPath(null)
          setDeleteWsConfirm('')
        }
        return result
      } catch {
        return {
          success: false,
          code: 'filesystem_error',
          error: '删除工作区失败，请重试',
          workspacePaths,
        }
      } finally {
        setIsDeletingWorkspace(false)
      }
    })()
    deleteInFlightRef.current = operation
    const clearDeletion = () => {
      if (deleteInFlightRef.current === operation) deleteInFlightRef.current = null
    }
    void operation.then(clearDeletion, clearDeletion)
    return operation
  }, [deleteWsPath, fixedWorkspacePaths, workspacePaths])

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
    handleOpenNewWorkspaceModal,
    dialogs: {
      create: {
        open: showNewWorkspaceModal,
        visible: modalVisible,
        name: newWorkspaceName,
        error: newWorkspaceError,
        pending: isCreatingWorkspace,
        setName: handleNewWorkspaceNameChange,
        close: handleCloseNewWorkspaceModal,
        submit: handleCreateWorkspace,
      },
      remove: {
        path: deleteWsPath,
        confirmation: deleteWsConfirm,
        pending: isDeletingWorkspace,
        setConfirmation: setDeleteWsConfirm,
        close: handleCloseDeleteWorkspace,
        submit: handleDeleteWorkspace,
      },
    } satisfies WorkspaceDialogsController,
  }
}
