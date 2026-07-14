import { describe, expect, it } from 'vitest'
import type { AskUserRequestIPC } from '../src/shared/types'
import {
  answerCurrentAskUserQuestion,
  createAskUserFlow,
  previousAskUserStep,
  toggleAskUserSelection,
} from '../src/renderer/components/chat/ask-user-flow'

const request: AskUserRequestIPC = {
  id: 'request-1',
  questions: [
    { question: 'Name?', options: [], multiSelect: false },
    { question: 'Mode?', options: [{ label: 'Fast' }], multiSelect: false },
    { question: 'Tools?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
  ],
}

describe('AskUser flow', () => {
  it('collects text, single-select, and multi-select answers before completing', () => {
    let state = createAskUserFlow(request.id)

    const first = answerCurrentAskUserQuestion(request, state, 'Sumi')!
    expect(first.completedAnswers).toBeNull()
    state = first.state

    const second = answerCurrentAskUserQuestion(request, state, 'Fast')!
    expect(second.completedAnswers).toBeNull()
    state = toggleAskUserSelection(second.state, 'Tools?', 'A')
    state = toggleAskUserSelection(state, 'Tools?', 'B')

    const third = answerCurrentAskUserQuestion(request, state, Array.from(state.selections['Tools?']).join(', '))!
    expect(third.completedAnswers).toEqual({
      'Name?': 'Sumi',
      'Mode?': 'Fast',
      'Tools?': 'A, B',
    })
  })

  it('moves back without losing earlier answers and lets the current answer be replaced', () => {
    const first = answerCurrentAskUserQuestion(request, createAskUserFlow(request.id), 'Old')!
    const previous = previousAskUserStep(first.state)
    const replacement = answerCurrentAskUserQuestion(request, previous, 'New')!

    expect(replacement.state.answers['Name?']).toBe('New')
    expect(replacement.state.step).toBe(1)
  })

  it('starts a queued request with isolated state', () => {
    const next = createAskUserFlow('request-2')
    expect(next).toEqual({ requestId: 'request-2', step: 0, answers: {}, selections: {} })
  })

  it('completes a single free-text question immediately', () => {
    const single = { ...request, questions: request.questions.slice(0, 1) }
    const result = answerCurrentAskUserQuestion(single, createAskUserFlow(single.id), 'Answer')!
    expect(result.completedAnswers).toEqual({ 'Name?': 'Answer' })
  })
})
