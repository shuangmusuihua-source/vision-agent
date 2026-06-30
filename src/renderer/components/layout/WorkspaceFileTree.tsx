import { useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoveRight,
  Pencil,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'
import type { FileEntry } from '../../../shared/types'

type EditState =
  | { kind: 'create-file' | 'create-directory'; parentPath: string; value: string }
  | { kind: 'rename'; entry: FileEntry; value: string }

interface WorkspaceFileTreeProps {
  rootPath: string
  entries: FileEntry[]
  onOpenFile: (path: string) => void
  onCreateFile: (parentPath: string, name: string) => Promise<void>
  onCreateDirectory: (parentPath: string, name: string) => Promise<void>
  onRenameEntry: (entry: FileEntry, name: string) => Promise<void>
  onDeleteEntry: (entry: FileEntry) => Promise<void>
  onMoveFile: (sourcePath: string, targetDir: string) => Promise<void>
  onRefresh: () => void
}

function TreeInput({
  value,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="sidebar-tree-input-row">
      <input
        className="sidebar-rename-input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
    </div>
  )
}

export default function WorkspaceFileTree({
  rootPath,
  entries,
  onOpenFile,
  onCreateFile,
  onCreateDirectory,
  onRenameEntry,
  onDeleteEntry,
  onMoveFile,
  onRefresh,
}: WorkspaceFileTreeProps): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditState | null>(null)
  const [movingFile, setMovingFile] = useState<string | null>(null)

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const submitEdit = async () => {
    if (!editing) return
    const value = editing.value.trim()
    if (!value) return
    const activeEdit = editing
    setEditing(null)
    if (activeEdit.kind === 'rename') {
      await onRenameEntry(activeEdit.entry, value)
    } else if (activeEdit.kind === 'create-file') {
      await onCreateFile(activeEdit.parentPath, value)
    } else {
      await onCreateDirectory(activeEdit.parentPath, value)
    }
  }

  const updateEditValue = (value: string) => {
    setEditing((current) => current ? { ...current, value } : null)
  }

  const renderEntries = (items: FileEntry[], depth: number): React.ReactNode => items.map((entry) => {
    const isExpanded = expanded.has(entry.path)
    const isRenaming = editing?.kind === 'rename' && editing.entry.path === entry.path
    return (
      <div key={entry.path} className="sidebar-tree-node">
        <div
          className={`sidebar-entry ${entry.isDirectory ? 'sidebar-folder' : 'sidebar-file'}`}
          style={{ paddingLeft: 14 + depth * 14 }}
        >
          {isRenaming ? (
            <div className="sidebar-file-main">
              {entry.isDirectory
                ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
                : <span className="sidebar-tree-indent" />}
              {entry.isDirectory
                ? (isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />)
                : <FileText size={13} />}
              <input
                className="sidebar-rename-input"
                value={editing.value}
                aria-label="新名称"
                autoFocus
                onChange={(event) => updateEditValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => setEditing(null)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submitEdit()
                  if (event.key === 'Escape') setEditing(null)
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="sidebar-file-main"
              onClick={() => entry.isDirectory ? toggleDirectory(entry.path) : onOpenFile(entry.path)}
              aria-expanded={entry.isDirectory ? isExpanded : undefined}
              title={entry.path}
            >
              {entry.isDirectory
                ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
                : <span className="sidebar-tree-indent" />}
              {entry.isDirectory
                ? (isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />)
                : <FileText size={13} />}
              <span className="sidebar-file-name">{entry.name}</span>
            </button>
          )}

          {!isRenaming && (
            <div className="sidebar-tree-actions">
              {movingFile && entry.isDirectory && (
                <button
                  type="button"
                  className="sidebar-file-action"
                  title="移到此目录"
                  aria-label={`移到 ${entry.name}`}
                  onClick={() => { void onMoveFile(movingFile, entry.path); setMovingFile(null) }}
                >
                  <Check size={11} />
                </button>
              )}
              {entry.isDirectory && !movingFile && (
                <>
                  <button
                    type="button"
                    className="sidebar-file-action"
                    title="新建文件"
                    aria-label={`在 ${entry.name} 中新建文件`}
                    onClick={() => { setExpanded(current => new Set(current).add(entry.path)); setEditing({ kind: 'create-file', parentPath: entry.path, value: '' }) }}
                  >
                    <FilePlus2 size={11} />
                  </button>
                  <button
                    type="button"
                    className="sidebar-file-action"
                    title="新建文件夹"
                    aria-label={`在 ${entry.name} 中新建文件夹`}
                    onClick={() => { setExpanded(current => new Set(current).add(entry.path)); setEditing({ kind: 'create-directory', parentPath: entry.path, value: '' }) }}
                  >
                    <FolderPlus size={11} />
                  </button>
                </>
              )}
              {!entry.isDirectory && !movingFile && (
                <button
                  type="button"
                  className="sidebar-file-action"
                  title="移动文件"
                  aria-label={`移动 ${entry.name}`}
                  onClick={() => setMovingFile(entry.path)}
                >
                  <MoveRight size={11} />
                </button>
              )}
              {!movingFile && (
                <>
                  <button
                    type="button"
                    className="sidebar-file-action"
                    title="重命名"
                    aria-label={`重命名 ${entry.name}`}
                    onClick={() => setEditing({ kind: 'rename', entry, value: entry.name })}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    className="sidebar-file-action sidebar-file-action-danger"
                    title="删除"
                    aria-label={`删除 ${entry.name}`}
                    onClick={() => void onDeleteEntry(entry)}
                  >
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {entry.isDirectory && isExpanded && (
          <div>
            {editing?.kind !== 'rename' && editing?.parentPath === entry.path && (
              <div style={{ paddingLeft: 32 + depth * 14 }}>
                <TreeInput
                  value={editing.value}
                  placeholder={editing.kind === 'create-file' ? '文件名' : '文件夹名称'}
                  onChange={updateEditValue}
                  onSubmit={() => void submitEdit()}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}
            {renderEntries(entry.children || [], depth + 1)}
          </div>
        )}
      </div>
    )
  })

  return (
    <section className="sidebar-file-tree" aria-label="文件">
      <div className="sidebar-files-header">
        <span>文件</span>
        <div className="sidebar-tree-actions sidebar-tree-actions-visible">
          {movingFile ? (
            <>
              <button type="button" className="sidebar-file-action" onClick={() => { void onMoveFile(movingFile, rootPath); setMovingFile(null) }} title="移到工作区根目录" aria-label="移到工作区根目录">
                <Check size={11} />
              </button>
              <button type="button" className="sidebar-file-action" onClick={() => setMovingFile(null)} title="取消移动" aria-label="取消移动">
                <X size={11} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="sidebar-file-action" onClick={() => setEditing({ kind: 'create-file', parentPath: rootPath, value: '' })} title="新建文件" aria-label="新建文件">
                <FilePlus2 size={11} />
              </button>
              <button type="button" className="sidebar-file-action" onClick={() => setEditing({ kind: 'create-directory', parentPath: rootPath, value: '' })} title="新建文件夹" aria-label="新建文件夹">
                <FolderPlus size={11} />
              </button>
              <button type="button" className="sidebar-file-action" onClick={onRefresh} title="刷新文件" aria-label="刷新文件">
                <RotateCw size={11} />
              </button>
            </>
          )}
        </div>
      </div>

      {movingFile && <div className="sidebar-tree-status" role="status">选择目标文件夹</div>}
      {editing?.kind !== 'rename' && editing?.parentPath === rootPath && (
        <TreeInput
          value={editing.value}
          placeholder={editing.kind === 'create-file' ? '文件名' : '文件夹名称'}
          onChange={updateEditValue}
          onSubmit={() => void submitEdit()}
          onCancel={() => setEditing(null)}
        />
      )}
      {entries.length > 0 ? renderEntries(entries, 0) : <div className="sidebar-tree-empty">暂无 Markdown 文件</div>}
    </section>
  )
}
