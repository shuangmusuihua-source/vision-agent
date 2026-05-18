import { useEffect } from 'react'
import { ShieldWarning, Check, X } from '@phosphor-icons/react'
import type { PermissionRequest } from '../../store/agent-store'

interface PermissionDialogProps {
  request: PermissionRequest
  onRespond: (requestId: string, behavior: 'allow' | 'deny') => void
}

function PermissionDialog({ request, onRespond }: PermissionDialogProps): React.ReactElement {
  const inputSummary = summarizePermissionInput(request.toolName, request.input)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onRespond(request.id, 'allow')
      else if (e.key === 'Escape') onRespond(request.id, 'deny')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [request.id, onRespond])

  return (
    <div className="permission-overlay">
      <div className="permission-dialog" role="dialog" aria-modal="true" aria-label="Permission Request">
        <div className="permission-header">
          <ShieldWarning size={16} weight="bold" className="permission-icon" />
          <span className="permission-title">Permission Request</span>
        </div>
        <div className="permission-body">
          <div className="permission-tool">
            <span className="permission-label">Tool</span>
            <span className="permission-tool-name">{request.toolName}</span>
          </div>
          {inputSummary && (
            <div className="permission-detail">
              <span className="permission-label">Detail</span>
              <code className="permission-detail-code">{inputSummary}</code>
            </div>
          )}
        </div>
        <div className="permission-actions">
          <button
            className="permission-btn permission-btn-allow"
            onClick={() => onRespond(request.id, 'allow')}
          >
            <Check size={14} weight="bold" />
            Allow
          </button>
          <button
            className="permission-btn permission-btn-deny"
            onClick={() => onRespond(request.id, 'deny')}
          >
            <X size={14} weight="bold" />
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}

function summarizePermissionInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return String(input.command || '')
    case 'Read':
      return String(input.file_path || '')
    case 'Write':
      return String(input.file_path || '')
    case 'Edit':
      return String(input.file_path || '')
    default: {
      const vals = Object.values(input)
      if (vals.length > 0) return String(vals[0])
      return ''
    }
  }
}

export default PermissionDialog