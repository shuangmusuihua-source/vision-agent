import React from 'react'
import { FileText } from '@phosphor-icons/react'

interface ContextZoneProps {
  activeFilePath?: string
}

function ContextZone({ activeFilePath }: ContextZoneProps): React.ReactElement | null {
  if (!activeFilePath) return null

  const fileName = activeFilePath.split('/').pop() || activeFilePath

  return (
    <div className="context-zone-tag context-zone-tag--file" title={activeFilePath}>
      <FileText size={12} weight="regular" />
      <span>{fileName}</span>
    </div>
  )
}

export default ContextZone
