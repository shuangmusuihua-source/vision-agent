import { useState, useCallback, useEffect, useRef } from 'react'
import type { FileEntry } from '../lib/ipc'
import { filterUserWorkspacePaths, isReservedKnowledgeWorkspacePath, KNOWLEDGE_BASE_NAME } from '../../shared/workspace-paths'

interface UseWorkspaceOptions {
  /** Called after file operations that change the files list. */
  onFilesChanged?: () => void
}

/**
 * Workspace management — paths, file listing, CRUD modals.
 *
 * Keeps workspace-level state (paths, files, modals) in one place.
 * File operations that bridge workspace and tabs (delete/rename/move)
 * stay in AppShell; this hook provides the pure-workspace building blocks.
 */
export function useWorkspace({ onFilesChanged }: UseWorkspaceOptions = {}) {
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [fixedWorkspacePaths, setFixedWorkspacePaths] = useState<string[]>([])
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})

  // Knowledge base dir
  useEffect(() => {
    window.api.workspace.knowledgeDir().then(dir => {
      setFixedWorkspacePaths([dir])
      setWorkspacePaths((prev) => filterUserWorkspacePaths(prev, [dir]))
      setFiles((prev) => {
        const next: Record<string, FileEntry[]> = {}
        for (const [path, entries] of Object.entries(prev)) {
          if (!isReservedKnowledgeWorkspacePath(path, [dir])) {
            next[path] = entries
          }
        }
        return next
      })
    })
  }, [])

  // ── Settings sync ──────────────────────────────────────────────────

  const prevAuthDirsRef = useRef<string>('')

  /** Pull workspace dirs + file listings from cached settings on change. */
  function syncFromSettings(dirs: string[], fixedDirs: string[] = fixedWorkspacePaths): void {
    const userDirs = filterUserWorkspacePaths(dirs, fixedDirs)
    const key = `${userDirs.join(',')}::${fixedDirs.join(',')}`
    if (key === prevAuthDirsRef.current) return
    prevAuthDirsRef.current = key
    setWorkspacePaths(userDirs)
    const fileEntries: Record<string, FileEntry[]> = {}
    Promise.all(
      userDirs.map(async (dir) => {
        fileEntries[dir] = await window.api.workspace.listFiles(dir)
      })
    ).then(() => setFiles(fileEntries))
  }

  async function refreshFiles(paths: string[]): Promise<void> {
    const fileEntries: Record<string, FileEntry[]> = {}
    await Promise.all(
      paths.map(async (dir) => {
        fileEntries[dir] = await window.api.workspace.listFiles(dir)
      })
    )
    setFiles(fileEntries)
    onFilesChanged?.()
  }

  // ── Workspace-level handlers ──────────────────────────────────────

  const handleRefreshWorkspace = useCallback(async (path: string) => {
    const entries = await window.api.workspace.listFiles(path)
    setFiles((prev) => ({ ...prev, [path]: entries }))
  }, [])

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
          const entries = await window.api.workspace.listFiles(dirPath)
          setFiles((prev) => ({ ...prev, [dirPath]: entries }))
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
      setFiles((prev) => {
        const next = { ...prev }
        delete next[deleteWsPath!]
        return next
      })
      setDeleteWsPath(null)
      onFilesChanged?.()
    }
    return result
  }, [deleteWsPath, onFilesChanged])

  // ── Bulk file refresh (called after agent finishes) ────────────────

  const refreshAllFiles = useCallback(async (paths: string[]) => {
    const results = await Promise.all(
      paths.map(async (dir) => {
        const entries = await window.api.workspace.listFiles(dir)
        return { dir, entries }
      })
    )
    setFiles((prev) => {
      const next = { ...prev }
      for (const { dir, entries } of results) {
        next[dir] = entries
      }
      return next
    })
  }, [])

  return {
    // State
    workspacePaths,
    setWorkspacePaths,
    fixedWorkspacePaths,
    files,
    setFiles,
    // Settings
    syncFromSettings,
    refreshFiles,
    refreshAllFiles,
    // Workspace handlers
    handleRefreshWorkspace,
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
