import { ArrowElbowDownLeft } from '@phosphor-icons/react'
import { InputDrawer } from './InputDrawer'
import type { AskUserRequestIPC as AskUserRequest } from '../../../shared/types'

interface AskUserDrawerProps {
  request: AskUserRequest
  open: boolean
  onClose: () => void
  onRespond: (answer: string) => void
}

function AskUserDrawer({ request, open, onClose, onRespond }: AskUserDrawerProps): React.ReactElement {
  return (
    <InputDrawer open={open} onClose={onClose}>
      <div className="drawer-question">
        <div className="drawer-question-text">{request.question}</div>
        {request.options && request.options.length > 0 && (
          <div className="drawer-question-options">
            {request.options.map((opt) => (
              <button
                key={opt.label}
                className="drawer-question-option"
                onClick={() => onRespond(opt.label)}
              >
                <span className="drawer-question-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="drawer-question-option-desc">{opt.description}</span>
                )}
                <ArrowElbowDownLeft size={14} weight="bold" className="drawer-question-option-icon" />
              </button>
            ))}
          </div>
        )}
        <div className="drawer-question-hint">或直接在下方输入回答</div>
      </div>
    </InputDrawer>
  )
}

export default AskUserDrawer
