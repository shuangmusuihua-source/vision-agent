import { useState, useRef, useEffect, useCallback } from 'react'
import { File, Folder, FolderOpen, CaretRight, CaretDown, Brain, Trash, X, MagnifyingGlass, Gear, Graph, Plus, PlusSquare } from '@phosphor-icons/react'
import type { FileEntry } from '../lib/ipc'

interface MemoryEntry {
  name: string
  path: string
}

interface SidebarProps {
  files: Record<string, FileEntry[]>
  workspacePaths: string[]
  memoryRefreshKey: number
  onFileSelect: (path: string) => void
  onOpenDirectory: () => void
  onNewWorkspace: () => void
  onRemoveWorkspace: (path: string) => void
  onRefreshWorkspace: (path: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleGraph: () => void
  showGraph: boolean
  collapsed: boolean
}

function Sidebar({
  files,
  workspacePaths,
  memoryRefreshKey,
  onFileSelect,
  onOpenDirectory,
  onNewWorkspace,
  onRemoveWorkspace,
  onRefreshWorkspace,
  onOpenSettings,
  onOpenSearch,
  onToggleGraph,
  showGraph,
  collapsed
}: SidebarProps): React.ReactElement {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [memoryFiles, setMemoryFiles] = useState<MemoryEntry[]>([])
  const [creatingFileIn, setCreatingFileIn] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creatingFileIn) {
      setNewFileName('')
      setCreateError(null)
      setTimeout(() => newFileInputRef.current?.focus(), 50)
    }
  }, [creatingFileIn])

  const handleCreateFile = async (wsPath: string) => {
    const name = newFileName.trim()
    if (!name) return
    const result = await window.api.workspace.createFile(wsPath, name)
    if (result.success && result.path) {
      setCreatingFileIn(null)
      onRefreshWorkspace(wsPath)
      onFileSelect(result.path)
    } else {
      setCreateError(result.error || '创建失败')
    }
  }

  const refreshMemory = useCallback(() => {
    window.api.memory.list().then(setMemoryFiles).catch(() => setMemoryFiles([]))
  }, [])

  useEffect(() => {
    refreshMemory()
  }, [memoryRefreshKey, refreshMemory])

  const handleDeleteMemory = useCallback(async (filePath: string) => {
    await window.api.memory.delete(filePath)
    refreshMemory()
  }, [refreshMemory])

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const renderTree = (entries: FileEntry[], depth: number): React.ReactElement[] => {
    return entries.map((entry) => {
      const isExpanded = expandedDirs.has(entry.path)
      const paddingLeft = 8 + depth * 16

      if (entry.isDirectory) {
        return (
          <div key={entry.path}>
            <div
              className="sidebar-entry sidebar-folder"
              style={{ paddingLeft }}
              onClick={() => toggleDir(entry.path)}
            >
              {isExpanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
              {isExpanded ? <FolderOpen size={14} weight="bold" /> : <Folder size={14} weight="bold" />}
              <span>{entry.name}</span>
            </div>
            {isExpanded && entry.children && renderTree(entry.children, depth + 1)}
          </div>
        )
      }

      return (
        <div
          key={entry.path}
          className="sidebar-entry sidebar-file"
          style={{ paddingLeft: paddingLeft + 14 }}
          onClick={() => onFileSelect(entry.path)}
        >
          <File size={14} weight="bold" />
          <span>{entry.name}</span>
        </div>
      )
    })
  }

  const workspaceName = (path: string) => path.split('/').pop() || path

  return (
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button className="sidebar-icon-btn" onClick={onOpenSearch} title="搜索 (⌘⇧F)">
            <MagnifyingGlass size={14} weight="bold" />
          </button>
          <button className={`sidebar-icon-btn${showGraph ? ' sidebar-icon-btn-active' : ''}`} onClick={onToggleGraph} title="图谱视图">
            <Graph size={14} weight="bold" />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenDirectory} title="打开工作区">
            <FolderOpen size={14} weight="bold" />
          </button>
          <button className="sidebar-icon-btn" onClick={onNewWorkspace} title="新建工作区">
            <PlusSquare size={14} weight="bold" />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置">
            <Gear size={14} weight="bold" />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {workspacePaths.length === 0 ? (
          <div className="sidebar-empty-workspace">
            <button className="sidebar-open-dir-btn" onClick={onOpenDirectory}>
              打开工作区
            </button>
            <button className="sidebar-new-dir-btn" onClick={onNewWorkspace}>
              新建工作区
            </button>
          </div>
        ) : (
          workspacePaths.map((wsPath) => (
            <div key={wsPath} className="sidebar-workspace-section">
              <div className="sidebar-workspace-header">
                <span className="sidebar-workspace-name">{workspaceName(wsPath)}</span>
                <button
                  className="sidebar-workspace-remove"
                  onClick={() => { setCreatingFileIn(null); onRemoveWorkspace(wsPath) }}
                  title="移除工作区"
                >
                  <X size={12} weight="bold" />
                </button>
                <button
                  className="sidebar-workspace-add-file"
                  onClick={() => setCreatingFileIn(wsPath)}
                  title="新建文件"
                >
                  <Plus size={12} weight="bold" />
                </button>
              </div>
              {creatingFileIn === wsPath && (
                <div className="sidebar-new-file-input">
                  <input
                    ref={newFileInputRef}
                    className="sidebar-new-file-field"
                    placeholder="文件名（自动添加 .md）"
                    value={newFileName}
                    onChange={(e) => { setNewFileName(e.target.value); setCreateError(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFile(wsPath)
                      if (e.key === 'Escape') setCreatingFileIn(null)
                    }}
                  />
                  {createError && <span className="sidebar-new-file-error">{createError}</span>}
                </div>
              )}
              {renderTree(files[wsPath] || [], 0)}
            </div>
          ))
        )}

        {memoryFiles.length > 0 && (
          <div className="sidebar-memory-section">
            <div
              className="sidebar-entry sidebar-folder"
              style={{ paddingLeft: 8 }}
              onClick={() => setMemoryExpanded((v) => !v)}
            >
              {memoryExpanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
              <Brain size={14} weight="bold" />
              <span>Memory</span>
            </div>
            {memoryExpanded && memoryFiles.map((file) => (
              <div
                key={file.path}
                className="sidebar-entry sidebar-file sidebar-memory-entry"
                style={{ paddingLeft: 24 }}
                onClick={() => onFileSelect(file.path)}
              >
                <File size={14} weight="bold" />
                <span className="sidebar-memory-name">{file.name}</span>
                <button
                  className="sidebar-memory-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteMemory(file.path)
                  }}
                >
                  <Trash size={12} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Sidebar