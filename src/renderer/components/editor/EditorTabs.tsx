import { useCallback } from 'react'
import { X } from '@phosphor-icons/react'

interface EditorTabsProps {
  tabs: string[]
  activeTab: string
  onTabSwitch: (path: string) => void
  onTabClose: (path: string) => void
}

function EditorTabs({ tabs, activeTab, onTabSwitch, onTabClose }: EditorTabsProps): React.ReactElement {
  const getFileName = (path: string): string => {
    return path.split('/').pop() || path
  }

  const handleClose = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    onTabClose(path)
  }, [onTabClose])

  return (
    <div className="editor-tabs">
      {tabs.map((path) => (
        <div
          key={path}
          className={`editor-tab ${path === activeTab ? 'editor-tab-active' : ''}`}
          onClick={() => onTabSwitch(path)}
        >
          <span className="editor-tab-name">{getFileName(path)}</span>
          <button
            className="editor-tab-close"
            onClick={(e) => handleClose(e, path)}
          >
            <X size={12} weight="regular" />
          </button>
        </div>
      ))}
    </div>
  )
}

export default EditorTabs