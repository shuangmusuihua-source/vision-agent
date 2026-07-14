import { useState, useCallback, useEffect } from 'react'
import { CornerDownLeft, Check, ChevronLeft } from 'lucide-react'
import { InputDrawer } from './InputDrawer'
import type { AskUserRequestIPC as AskUserRequest } from '../../../shared/types'
import {
  answerCurrentAskUserQuestion,
  createAskUserFlow,
  previousAskUserStep,
  toggleAskUserSelection,
} from './ask-user-flow'

interface AskUserDrawerProps {
  request: AskUserRequest
  open: boolean
  onClose: () => void
  onRespond: (answers: Record<string, string>) => void
  onTextSubmitReady?: (handler: AskUserTextSubmitHandler | null) => void
}

export type AskUserTextSubmitHandler = {
  requestId: string
  submit: (answer: string) => void
}

function AskUserDrawer({ request, open, onClose, onRespond, onTextSubmitReady }: AskUserDrawerProps): React.ReactElement {
  const [flow, setFlow] = useState(() => createAskUserFlow(request.id))

  const questions = request.questions
  const currentQ = questions[flow.step]
  const isLastStep = flow.step >= questions.length - 1
  const totalSteps = questions.length

  const currentSelected = flow.selections[currentQ?.question] || new Set<string>()

  const handleToggle = useCallback((label: string) => {
    if (!currentQ) return
    setFlow((prev) => toggleAskUserSelection(prev, currentQ.question, label))
  }, [currentQ?.question])

  const submitAnswer = useCallback((answer: string) => {
    const result = answerCurrentAskUserQuestion(request, flow, answer)
    if (!result) return
    setFlow(result.state)
    if (result.completedAnswers) onRespond(result.completedAnswers)
  }, [flow, onRespond, request])

  const handleSingleSelect = useCallback((label: string) => {
    if (currentQ.multiSelect) {
      handleToggle(label)
      return
    }
    // Single select — submit immediately or advance
    submitAnswer(label)
  }, [currentQ, handleToggle, submitAnswer])

  const handleMultiSubmit = useCallback(() => {
    submitAnswer(Array.from(currentSelected).join(', '))
  }, [currentSelected, submitAnswer])

  const handlePrev = useCallback(() => {
    setFlow(previousAskUserStep)
  }, [])

  useEffect(() => {
    onTextSubmitReady?.({ requestId: request.id, submit: submitAnswer })
    return () => onTextSubmitReady?.(null)
  }, [onTextSubmitReady, request.id, submitAnswer])

  const hasOptions = currentQ?.options && currentQ.options.length > 0
  const canSubmitMulti = currentQ?.multiSelect && currentSelected.size > 0

  return (
    <InputDrawer open={open} onClose={onClose}>
      <div className="drawer-question">
        {totalSteps > 1 && (
          <div className="drawer-question-steps">
            <button
              className="drawer-question-step-btn"
              onClick={handlePrev}
              disabled={flow.step === 0}
              aria-label="上一题"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="drawer-question-step-label">{flow.step + 1} / {totalSteps}</span>
            <div style={{ width: 28 }} />
          </div>
        )}
        <div className="drawer-question-text">{currentQ?.question}</div>
        {hasOptions && (
          <div className="drawer-question-options">
            {currentQ.options.map((opt) => {
              const isSelected = currentSelected.has(opt.label)
              if (currentQ.multiSelect) {
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
                  onClick={() => handleSingleSelect(opt.label)}
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
        {currentQ?.multiSelect && (
          <button
            className={`drawer-question-submit${canSubmitMulti ? '' : ' drawer-question-submit--disabled'}`}
            onClick={handleMultiSubmit}
            disabled={!canSubmitMulti}
          >
            {canSubmitMulti
              ? isLastStep ? `提交 (${currentSelected.size})` : `下一步 (${currentSelected.size})`
              : '请选择'}
          </button>
        )}
        {!currentQ?.multiSelect && (
          <div className="drawer-question-hint">或直接在下方输入回答</div>
        )}
      </div>
    </InputDrawer>
  )
}

export default AskUserDrawer
