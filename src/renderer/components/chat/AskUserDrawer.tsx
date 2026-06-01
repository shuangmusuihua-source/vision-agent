import { useState, useCallback } from 'react'
import { CornerDownLeft, Check } from 'lucide-react'
import { InputDrawer } from './InputDrawer'
import type { AskUserRequestIPC as AskUserRequest } from '../../../shared/types'

interface AskUserDrawerProps {
  request: AskUserRequest
  open: boolean
  onClose: () => void
  onRespond: (answer: string) => void
}

function AskUserDrawer({ request, open, onClose, onRespond }: AskUserDrawerProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const handleToggle = useCallback((label: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }, [])

  const handleSubmit = useCallback(() => {
    if (request.multiSelect) {
      const answer = Array.from(selected).join(', ')
      if (answer) onRespond(answer)
    }
  }, [selected, request.multiSelect, onRespond])

  return (
    <InputDrawer open={open} onClose={onClose}>
      <div className="drawer-question">
        <div className="drawer-question-text">{request.question}</div>
        {request.options && request.options.length > 0 && (
          <div className="drawer-question-options">
            {request.options.map((opt) => {
              const isSelected = selected.has(opt.label)
              if (request.multiSelect) {
                return (
                  <button
                    key={opt.label}
                    className={`drawer-question-option${isSelected ? ' selected' : ''}`}
                    onClick={() => handleToggle(opt.label)}
                  >
                    <div className="drawer-question-option-check">
                      {isSelected && <Check size={14} />}
                    </div>
                    <span className="drawer-question-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="drawer-question-option-desc">{opt.description}</span>
                    )}
                  </button>
                )
              }
              return (
                <button
                  key={opt.label}
                  className="drawer-question-option"
                  onClick={() => onRespond(opt.label)}
                >
                  <span className="drawer-question-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="drawer-question-option-desc">{opt.description}</span>
                  )}
                  <CornerDownLeft size={14} className="drawer-question-option-icon" />
                </button>
              )
            })}
          </div>
        )}
        {request.multiSelect && selected.size > 0 && (
          <button className="drawer-question-submit" onClick={handleSubmit}>
            提交所选 ({selected.size})
          </button>
        )}
        {!request.multiSelect && (
          <div className="drawer-question-hint">或直接在下方输入回答</div>
        )}
      </div>
    </InputDrawer>
  )
}

export default AskUserDrawer
