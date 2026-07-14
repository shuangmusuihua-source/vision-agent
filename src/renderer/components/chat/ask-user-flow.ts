import type { AskUserRequestIPC } from '../../../shared/types'

export type AskUserFlowState = {
  requestId: string
  step: number
  answers: Record<string, string>
  selections: Record<string, Set<string>>
}

export type AskUserAnswerResult = {
  state: AskUserFlowState
  completedAnswers: Record<string, string> | null
}

export function createAskUserFlow(requestId: string): AskUserFlowState {
  return { requestId, step: 0, answers: {}, selections: {} }
}

export function toggleAskUserSelection(
  state: AskUserFlowState,
  question: string,
  label: string,
): AskUserFlowState {
  const nextSelection = new Set(state.selections[question] || [])
  if (nextSelection.has(label)) nextSelection.delete(label)
  else nextSelection.add(label)
  return {
    ...state,
    selections: { ...state.selections, [question]: nextSelection },
  }
}

export function previousAskUserStep(state: AskUserFlowState): AskUserFlowState {
  return { ...state, step: Math.max(0, state.step - 1) }
}

export function answerCurrentAskUserQuestion(
  request: AskUserRequestIPC,
  state: AskUserFlowState,
  answer: string,
): AskUserAnswerResult | null {
  const question = request.questions[state.step]
  if (!question) return null

  const answers = { ...state.answers, [question.question]: answer }
  const isLastStep = state.step >= request.questions.length - 1
  const nextState = {
    ...state,
    answers,
    step: isLastStep ? state.step : state.step + 1,
  }
  return {
    state: nextState,
    completedAnswers: isLastStep ? answers : null,
  }
}
