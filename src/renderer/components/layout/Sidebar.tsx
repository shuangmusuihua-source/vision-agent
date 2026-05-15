import { useState, useCallback, useEffect } from 'react'
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, Brain, Trash2 } from 'lucide-react'
import type { FileEntry } from '../lib/ipc'

interface MemoryEntry {
  name: string
  path: string
}

interface SidebarProps {
  files: FileEntry[]
  workspacePath: string
  memoryRefreshKey: number
  onFileSelect: (path: string) => void
  onOpenDirectory: () => void
  onOpenSettings: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

function Sidebar({
  files,
  workspacePath,
  memoryRefreshKey,
  onFileSelect,
  onOpenDirectory,
  onOpenSettings,
  collapsed,
  onToggleCollapse
}: SidebarProps): React.ReactElement {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [memoryFiles, setMemoryFiles] = useState<MemoryEntry[]>([])

  const refreshMemory = useCallback(() => {
    window.api.memory.list().then(setMemoryFiles).catch(() => setMemoryFiles([]))
  }, [])

  useEffect(() => {
    refreshMemory()
  }, [workspacePath, memoryRefreshKey, refreshMemory])

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

  const renderTree = (entries: FileEntry[], depth: number): React.ReactNode => {
    return entries.map((entry) => {
      if (entry.isDirectory) {
        const isExpanded = expandedDirs.has(entry.path)
        return (
          <div key={entry.path}>
            <div
              className="sidebar-entry sidebar-folder"
              style={{ paddingLeft: depth * 16 + 8 }}
              onClick={() => toggleDir(entry.path)}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
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
          style={{ paddingLeft: depth * 16 + 24 }}
          onClick={() => onFileSelect(entry.path)}
        >
          <File size={14} />
          <span>{entry.name}</span>
        </div>
      )
    })
  }

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="sidebar-toggle-btn" onClick={onToggleCollapse}>
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">
          {workspacePath ? workspacePath.split('/').pop() : 'Vision Agent'}
        </span>
        <button className="sidebar-toggle-btn" onClick={onToggleCollapse}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="sidebar-content">
        {workspacePath ? (
          renderTree(files, 0)
        ) : (
          <button className="sidebar-open-dir-btn" onClick={onOpenDirectory}>
            Open Workspace
          </button>
        )}

        {memoryFiles.length > 0 && (
          <div className="sidebar-memory-section">
            <div
              className="sidebar-entry sidebar-folder"
              style={{ paddingLeft: 8 }}
              onClick={() => setMemoryExpanded((v) => !v)}
            >
              {memoryExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Brain size={14} />
              <span>Memory</span>
            </div>
            {memoryExpanded && memoryFiles.map((file) => (
              <div
                key={file.path}
                className="sidebar-entry sidebar-file sidebar-memory-entry"
                style={{ paddingLeft: 24 }}
                onClick={() => onFileSelect(file.path)}
              >
                <File size={14} />
                <span className="sidebar-memory-name">{file.name}</span>
                <button
                  className="sidebar-memory-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteMemory(file.path)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-settings-btn" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </div>
  )
}

export default Sidebar