import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { File, Folder, FolderOpen, CaretRight, CaretDown, Brain, Trash, X, MagnifyingGlass, Gear, Graph, Plus, PlusSquare, PushPin, Eye, ArrowsOutCardinal } from '@phosphor-icons/react'
import { Flipper, Flipped } from 'react-flip-toolkit'
import type { FileEntry } from '../../lib/ipc'

interface MemoryEntry {
  name: string
  path: string
}

interface SidebarProps {
  files: Record<string, FileEntry[]>
  workspacePaths: string[]
  memoryRefreshKey: number
  onFileSelect: (path: string) => void
  onNewWorkspace: () => void
  onFileDelete: (filePath: string) => void
  onFileMove: (filePath: string, targetDir: string) => void
  onRemoveWorkspace: (path: string) => void
  onRefreshWorkspace: (path: string) => void
  onReorderWorkspaces: (paths: string[]) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleGraph: () => void
  onDaydream: (mode: string) => void
  showGraph: boolean
  changedFileCount: number
  collapsed: boolean
}

function Sidebar({
  files,
  workspacePaths,
  memoryRefreshKey,
  onFileSelect,
  onNewWorkspace,
  onFileDelete,
  onFileMove,
  onRemoveWorkspace,
  onRefreshWorkspace,
  onReorderWorkspaces,
  onOpenSettings,
  onOpenSearch,
  onToggleGraph,
  onDaydream,
  showGraph,
  changedFileCount,
  collapsed
}: SidebarProps): React.ReactElement {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [memoryFiles, setMemoryFiles] = useState<MemoryEntry[]>([])
  const [creatingFileIn, setCreatingFileIn] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [movingFilePath, setMovingFilePath] = useState<string | null>(null)
  const [moveDropdownPos, setMoveDropdownPos] = useState({ left: 0, top: 0 })
  const moveDropdownRef = useRef<HTMLDivElement>(null)
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
    if (!window.confirm('确定删除此记忆文件？此操作不可撤销。')) return
    await window.api.memory.delete(filePath)
    refreshMemory()
  }, [refreshMemory])

  const handleDeleteFile = useCallback((filePath: string) => {
    if (!window.confirm('确定删除此文件？此操作不可撤销。')) return
    onFileDelete(filePath)
  }, [onFileDelete])

  const handleShowMoveDropdown = useCallback((filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setMoveDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setMovingFilePath(filePath)
  }, [])

  const handleMoveToWorkspace = useCallback((targetDir: string) => {
    if (movingFilePath) {
      onFileMove(movingFilePath, targetDir)
    }
    setMovingFilePath(null)
  }, [movingFilePath, onFileMove])

  useEffect(() => {
    if (!movingFilePath) return
    const handler = (e: MouseEvent) => {
      if (moveDropdownRef.current && moveDropdownRef.current.contains(e.target as Node)) return
      setMovingFilePath(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [movingFilePath])

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleWorkspace = useCallback((path: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handlePinToTop = useCallback((wsPath: string) => {
    const idx = workspacePaths.indexOf(wsPath)
    if (idx <= 0) return
    const reordered = [...workspacePaths]
    reordered.splice(idx, 1)
    reordered.unshift(wsPath)
    onReorderWorkspaces(reordered)
  }, [workspacePaths, onReorderWorkspaces])

  const workspaceName = (path: string) => path.split('/').pop() || path

  const renderTree = (entries: FileEntry[], depth: number, wsPath: string): React.ReactElement[] => {
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
            {isExpanded && entry.children && renderTree(entry.children, depth + 1, wsPath)}
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
          <span className="sidebar-file-name">{entry.name}</span>
          {workspacePaths.length > 1 && (
            <button
              className="sidebar-file-action"
              onClick={(e) => handleShowMoveDropdown(entry.path, e)}
              title="移动到其他工作区"
              aria-label="移动到其他工作区"
            >
              <ArrowsOutCardinal size={12} weight="bold" />
            </button>
          )}
          <button
            className="sidebar-file-action"
            onClick={(e) => { e.stopPropagation(); handleDeleteFile(entry.path) }}
            title="删除文件"
            aria-label="删除文件"
          >
            <Trash size={12} weight="bold" />
          </button>
        </div>
      )
    })
  }

  const [showDaydreamPicker, setShowDaydreamPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState({ left: 0, top: 0 })
  const daydreamBtnRef = useRef<HTMLButtonElement>(null)

  const togglePicker = () => {
    if (!showDaydreamPicker && daydreamBtnRef.current) {
      const rect = daydreamBtnRef.current.getBoundingClientRect()
      setPickerPos({ left: rect.left, top: rect.bottom + 6 })
    }
    setShowDaydreamPicker(v => !v)
  }

  useEffect(() => {
    if (!showDaydreamPicker) return
    const handler = (e: MouseEvent) => {
      if (daydreamBtnRef.current && daydreamBtnRef.current.contains(e.target as Node)) return
      const picker = document.querySelector('.daydream-picker')
      if (picker && picker.contains(e.target as Node)) return
      setShowDaydreamPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDaydreamPicker])

  return (
    <>
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button className="sidebar-icon-btn" onClick={onOpenSearch} title="搜索 (⌘⇧F)" aria-label="搜索">
            <MagnifyingGlass size={14} weight="bold" />
          </button>
          <button className={`sidebar-icon-btn${showGraph ? ' sidebar-icon-btn-active' : ''}`} onClick={onToggleGraph} title="图谱视图" aria-label="图谱视图">
            <Graph size={14} weight="bold" />
            {changedFileCount >= 2 && <span className="sidebar-badge-dot" />}
          </button>
          <button className="sidebar-icon-btn" onClick={onNewWorkspace} title="新建工作区" aria-label="新建工作区">
            <PlusSquare size={14} weight="bold" />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置" aria-label="设置">
            <Gear size={14} weight="bold" />
          </button>
          <button ref={daydreamBtnRef} className="sidebar-icon-btn" onClick={togglePicker} title="心休模式" aria-label="心休模式">
            <Eye size={14} weight="bold" />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {workspacePaths.length === 0 ? (
          <div className="sidebar-empty-workspace">
            <button className="sidebar-new-dir-btn" onClick={onNewWorkspace}>
              新建工作区
            </button>
          </div>
        ) : (
          <Flipper
            flipKey={workspacePaths.join(',')}
            spring={{ stiffness: 200, damping: 28 } as any}
            className="sidebar-workspace-list"
          >
            {workspacePaths.map((wsPath, idx) => {
              const isCollapsed = collapsedWorkspaces.has(wsPath)
              return (
                <Flipped key={wsPath} flipId={wsPath}>
                  <div className={`sidebar-workspace-section${isCollapsed ? ' sidebar-workspace-collapsed' : ''}`}>
                    <div className="sidebar-workspace-header">
                      <button
                        className="sidebar-workspace-toggle"
                        onClick={() => toggleWorkspace(wsPath)}
                        aria-label={isCollapsed ? '展开工作区' : '折叠工作区'}
                      >
                        {isCollapsed ? <CaretRight size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
                      </button>
                      <span className="sidebar-workspace-name">{workspaceName(wsPath)}</span>
                      {idx > 0 && (
                        <button
                          className="sidebar-workspace-pin"
                          onClick={() => handlePinToTop(wsPath)}
                          title="置顶"
                          aria-label="置顶"
                        >
                          <PushPin size={12} weight="bold" />
                        </button>
                      )}
                      <button
                        className="sidebar-workspace-remove"
                        onClick={() => { setCreatingFileIn(null); onRemoveWorkspace(wsPath) }}
                        title="移除工作区"
                        aria-label="移除工作区"
                      >
                        <X size={12} weight="bold" />
                      </button>
                      <button
                        className="sidebar-workspace-add-file"
                        onClick={() => setCreatingFileIn(wsPath)}
                        title="新建文件"
                        aria-label="新建文件"
                      >
                        <Plus size={12} weight="bold" />
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="sidebar-workspace-body">
                        {creatingFileIn === wsPath && (
                          <div className="sidebar-new-file-input">
                            <input
                              ref={newFileInputRef}
                              className="sidebar-new-file-field"
                              placeholder="文件名（自动添加 .md）"
                              value={newFileName}
                              onChange={(e) => { setNewFileName(e.target.value); setCreateError(null) }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.isComposing) handleCreateFile(wsPath)
                                if (e.key === 'Escape') setCreatingFileIn(null)
                              }}
                            />
                            {createError && <span className="sidebar-new-file-error">{createError}</span>}
                          </div>
                        )}
                        {renderTree(files[wsPath] || [], 0, wsPath)}
                      </div>
                    )}
                  </div>
                </Flipped>
              )
            })}
          </Flipper>
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
    {showDaydreamPicker && createPortal(
      <div className="daydream-picker" style={{ left: pickerPos.left, top: pickerPos.top }}>
        <div className="daydream-picker-title">心休模式</div>
        <button className="daydream-picker-item" onClick={() => { onDaydream('matrix'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview matrix-preview" />
          <span>数字矩阵</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('starfield'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview starfield-preview" />
          <span>星空夜语</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('math'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview math-preview" />
          <span>数理幻境</span>
        </button>
        <button className="daydream-picker-item" onClick={() => { onDaydream('rain'); setShowDaydreamPicker(false) }}>
          <span className="daydream-picker-preview rain-preview" />
          <span>绿野甘霖</span>
        </button>
      </div>,
      document.body
    )}
    {movingFilePath && createPortal(
      <div
        ref={moveDropdownRef}
        className="move-dropdown"
        style={{ left: moveDropdownPos.left, top: moveDropdownPos.top }}
      >
        <div className="move-dropdown-title">移动到工作区</div>
        {workspacePaths
          .filter(ws => !movingFilePath.startsWith(ws + '/'))
          .map(ws => (
            <button
              key={ws}
              className="move-dropdown-item"
              onClick={() => handleMoveToWorkspace(ws)}
            >
              <Folder size={14} weight="bold" />
              <span>{workspaceName(ws)}</span>
            </button>
          ))
        }
      </div>,
      document.body
    )}
    </>
  )
}

export default Sidebar