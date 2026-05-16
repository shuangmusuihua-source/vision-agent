import { useState, useCallback, useEffect } from 'react'
import { File, Folder, FolderOpen, CaretRight, CaretDown, Brain, Trash, X, MagnifyingGlass, Gear } from '@phosphor-icons/react'
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
  onRemoveWorkspace: (path: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  collapsed: boolean
}

function Sidebar({
  files,
  workspacePaths,
  memoryRefreshKey,
  onFileSelect,
  onOpenDirectory,
  onRemoveWorkspace,
  onOpenSettings,
  onOpenSearch,
  collapsed
}: SidebarProps): React.ReactElement {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [memoryFiles, setMemoryFiles] = useState<MemoryEntry[]>([])

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
              {isExpanded ? <CaretDown size={14} weight="regular" /> : <CaretRight size={14} weight="regular" />}
              {isExpanded ? <FolderOpen size={14} weight="regular" /> : <Folder size={14} weight="regular" />}
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
          <File size={14} weight="regular" />
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
            <MagnifyingGlass size={14} weight="regular" />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenDirectory} title="打开工作区">
            <FolderOpen size={14} weight="regular" />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置">
            <Gear size={14} weight="regular" />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {workspacePaths.length === 0 ? (
          <button className="sidebar-open-dir-btn" onClick={onOpenDirectory}>
            Open Workspace
          </button>
        ) : (
          workspacePaths.map((wsPath) => (
            <div key={wsPath} className="sidebar-workspace-section">
              <div className="sidebar-workspace-header">
                <span className="sidebar-workspace-name">{workspaceName(wsPath)}</span>
                <button
                  className="sidebar-workspace-remove"
                  onClick={() => onRemoveWorkspace(wsPath)}
                  title="Remove workspace"
                >
                  <X size={12} weight="regular" />
                </button>
              </div>
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
              {memoryExpanded ? <CaretDown size={14} weight="regular" /> : <CaretRight size={14} weight="regular" />}
              <Brain size={14} weight="regular" />
              <span>Memory</span>
            </div>
            {memoryExpanded && memoryFiles.map((file) => (
              <div
                key={file.path}
                className="sidebar-entry sidebar-file sidebar-memory-entry"
                style={{ paddingLeft: 24 }}
                onClick={() => onFileSelect(file.path)}
              >
                <File size={14} weight="regular" />
                <span className="sidebar-memory-name">{file.name}</span>
                <button
                  className="sidebar-memory-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteMemory(file.path)
                  }}
                >
                  <Trash size={12} weight="regular" />
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