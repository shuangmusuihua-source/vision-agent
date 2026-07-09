import { File, X } from 'lucide-react'

interface DrawerZoneProps {
  linkedFile: string | null
  onUnlinkFile: () => void
}

function DrawerZone({ linkedFile, onUnlinkFile }: DrawerZoneProps): React.ReactElement | null {
  if (!linkedFile) return null

  const fileName = linkedFile.split('/').pop()

  return (
    <div className="drawer-zone">
      <div className="drawer">
        <div className="drawer-lip drawer-file-lip">
          <div className="drawer-lip-left">
            <div className="drawer-lip-icon">
              <File size={12} />
            </div>
            <span className="drawer-file-tag-name" title={linkedFile}>{fileName}</span>
          </div>
          <button className="drawer-file-tag-close" onClick={onUnlinkFile} title="取消关联文档" aria-label="取消关联文档">
            <X size={10} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default DrawerZone
