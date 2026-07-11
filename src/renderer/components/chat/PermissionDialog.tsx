import { useEffect } from 'react'
import { ShieldAlert, Check, X, ShieldCheck } from 'lucide-react'
import { InputDrawer } from './InputDrawer'
import type { PermissionRequestIPC as PermissionRequest } from '../../../shared/types'

interface PermissionDialogProps {
  request: PermissionRequest
  onRespond: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => void
  queuePosition?: number
  queueTotal?: number
}

function PermissionDialog({ request, onRespond, queuePosition, queueTotal }: PermissionDialogProps): React.ReactElement {
  const inputSummary = summarizePermissionInput(request.toolName, request.input)
  const showBadge = queueTotal !== undefined && queueTotal > 1
  const hasSuggestions = request.suggestions && request.suggestions.length > 0

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRespond(request.id, 'deny', { decisionClassification: 'user_reject' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [request.id, onRespond])

  const displayName = request.displayName || request.toolName

  return (
    <InputDrawer key={request.id} open onClose={() => {}}>
      <div className="drawer-permission">
        <div className="drawer-permission-header">
          <ShieldAlert size={16} className="drawer-permission-icon" />
          <span className="drawer-permission-title">{request.title || '权限请求'}</span>
          {showBadge && (
            <span className="drawer-permission-badge">{queuePosition}/{queueTotal}</span>
          )}
          <span className="drawer-permission-tool">{displayName}</span>
        </div>
        {request.description && (
          <div className="drawer-permission-description">{request.description}</div>
        )}
        {inputSummary && (
          <div className="drawer-permission-body">
            <code className="drawer-permission-code">{inputSummary}</code>
          </div>
        )}
        <div className="drawer-permission-actions">
          <button className="drawer-permission-btn drawer-permission-btn--deny" onClick={() => onRespond(request.id, 'deny', { decisionClassification: 'user_reject' })}>
            <X size={14} /> Deny
          </button>
          <button className="drawer-permission-btn drawer-permission-btn--allow" onClick={() => onRespond(request.id, 'allow', { decisionClassification: 'user_temporary' })}>
            <Check size={14} /> Allow
          </button>
          {hasSuggestions && (
            <button className="drawer-permission-btn drawer-permission-btn--always" onClick={() => onRespond(request.id, 'allow', { updatedPermissions: request.suggestions as Array<Record<string, unknown>>, decisionClassification: 'user_permanent' })}>
              <ShieldCheck size={14} /> Always Allow
            </button>
          )}
        </div>
      </div>
    </InputDrawer>
  )
}

function summarizePermissionInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': return String(input.command || '')
    case 'Read': return String(input.file_path || '')
    case 'Write': return String(input.file_path || '')
    case 'Edit': return String(input.file_path || '')
    default: { const vals = Object.values(input); if (vals.length > 0) return String(vals[0]); return '' }
  }
}

export default PermissionDialog
