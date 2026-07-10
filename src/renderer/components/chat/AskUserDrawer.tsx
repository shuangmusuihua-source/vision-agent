import { useState, useCallback } from 'react'
import { CornerDownLeft, Check, ChevronLeft } from 'lucide-react'
import { InputDrawer } from './InputDrawer'
import type { AskUserRequestIPC as AskUserRequest } from '../../../shared/types'

interface AskUserDrawerProps {
  request: AskUserRequest
  open: boolean
  onClose: () => void
  onRespond: (answers: Record<string, string>) => void
}

function AskUserDrawer({ request, open, onClose, onRespond }: AskUserDrawerProps): React.ReactElement {
  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState<Record<string, Set<string>>>({})
  const [textInputs, setTextInputs] = useState<Record<string, string>>({})

  const questions = request.questions.length > 0 ? request.questions : [{
    question: request.question,
    header: request.header,
    options: request.options,
    multiSelect: request.multiSelect,
  }]

  const currentQ = questions[step]
  const isLastStep = step >= questions.length - 1
  const totalSteps = questions.length

  const currentSelected = selections[currentQ?.question] || new Set<string>()

  const handleToggle = useCallback((label: string) => {
    setSelections((prev) => {
      const qKey = currentQ.question
      const prevSet = prev[qKey] || new Set<string>()
      const nextSet = new Set(prevSet)
      if (nextSet.has(label)) {
        nextSet.delete(label)
      } else {
        nextSet.add(label)
      }
      return { ...prev, [qKey]: nextSet }
    })
  }, [currentQ?.question])

  const handleSingleSelect = useCallback((label: string) => {
    if (currentQ.multiSelect) {
      handleToggle(label)
      return
    }
    // Single select — submit immediately or advance
    const qKey = currentQ.question
    const newSelections = { ...selections, [qKey]: new Set([label]) }
    setSelections(newSelections)

    if (isLastStep) {
      // Build final answers map
      const answers = buildAnswers(newSelections, textInputs, questions)
      onRespond(answers)
    } else {
      setStep((s) => s + 1)
    }
  }, [currentQ, isLastStep, selections, textInputs, questions, onRespond, handleToggle])

  const handleMultiSubmit = useCallback(() => {
    const qKey = currentQ.question
    const selected = selections[qKey] || new Set()
    const answer = Array.from(selected).join(', ')
    const updatedTextInputs = { ...textInputs, [qKey]: answer }
    setTextInputs(updatedTextInputs)

    if (isLastStep) {
      const answers = buildAnswers(selections, updatedTextInputs, questions)
      onRespond(answers)
    } else {
      setStep((s) => s + 1)
    }
  }, [currentQ?.question, isLastStep, selections, textInputs, questions, onRespond])

  const handlePrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1))
  }, [])

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
              disabled={step === 0}
              aria-label="上一题"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="drawer-question-step-label">{step + 1} / {totalSteps}</span>
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

function buildAnswers(
  selections: Record<string, Set<string>>,
  textInputs: Record<string, string>,
  questions: Array<{ question: string }>
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const text = textInputs[q.question]
    if (text) {
      answers[q.question] = text
    } else {
      const selected = selections[q.question]
      if (selected && selected.size > 0) {
        answers[q.question] = Array.from(selected).join(', ')
      }
    }
  }
  return answers
}

export default AskUserDrawer
