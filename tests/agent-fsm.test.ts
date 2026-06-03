import { describe, it, expect } from 'vitest'
import { AGENT_TRANSITIONS } from '../src/shared/types'
import type { AgentState, AgentEvent } from '../src/shared/types'
import { transition } from '../src/renderer/store/agent-store-impl'

// ─── Transition table integrity ──────────────────────────────────

describe('AGENT_TRANSITIONS', () => {
  it('every state has a transition map', () => {
    const states: AgentState[] = [
      'idle', 'thinking', 'running', 'compacting',
      'waitingForUserInput', 'error',
    ]
    for (const s of states) {
      expect(AGENT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it('every transition target is a valid state', () => {
    const validStates = new Set<AgentState>([
      'idle', 'thinking', 'running', 'compacting',
      'waitingForUserInput', 'error',
    ])
    for (const [state, transitions] of Object.entries(AGENT_TRANSITIONS)) {
      for (const [event, target] of Object.entries(transitions)) {
        expect(
          validStates.has(target!),
          `${state} + ${event} → ${target} is not a valid state`
        ).toBe(true)
      }
    }
  })

  it('idle only accepts SEND_MESSAGE → thinking', () => {
    const t = AGENT_TRANSITIONS.idle
    expect(Object.keys(t).length).toBeGreaterThanOrEqual(1)
    expect(t['SEND_MESSAGE']).toBe('thinking')
  })

  it('thinking transitions to running on FIRST_CONTENT', () => {
    expect(AGENT_TRANSITIONS.thinking['FIRST_CONTENT']).toBe('running')
  })

  it('thinking can transition directly to error', () => {
    expect(AGENT_TRANSITIONS.thinking['RESULT_ERROR']).toBe('error')
  })

  it('thinking can be aborted', () => {
    expect(AGENT_TRANSITIONS.thinking['ABORT']).toBe('idle')
  })

  it('running can be aborted', () => {
    expect(AGENT_TRANSITIONS.running['ABORT']).toBe('idle')
  })

  it('waitingForUserInput returns to running on response', () => {
    expect(AGENT_TRANSITIONS.waitingForUserInput['ASK_USER_RESPONDED']).toBe('running')
  })

  it('waitingForUserInput moves to error on timeout', () => {
    expect(AGENT_TRANSITIONS.waitingForUserInput['ASK_USER_TIMEOUT']).toBe('error')
  })
})

// ─── transition() function ───────────────────────────────────────

describe('transition()', () => {
  it('returns the target state for valid transitions', () => {
    expect(transition('idle', { type: 'SEND_MESSAGE' })).toBe('thinking')
    expect(transition('thinking', { type: 'FIRST_CONTENT' })).toBe('running')
    expect(transition('thinking', { type: 'ABORT' })).toBe('idle')
    expect(transition('running', { type: 'RESULT_SUCCESS' })).toBe('idle')
  })

  it('returns current state for invalid transitions', () => {
    expect(transition('idle', { type: 'FIRST_CONTENT' })).toBe('idle')
    expect(transition('error', { type: 'FIRST_CONTENT' })).toBe('error')
    expect(transition('error', { type: 'RESULT_SUCCESS' })).toBe('error')
  })

  it('error can recover via SEND_MESSAGE', () => {
    expect(transition('error', { type: 'SEND_MESSAGE' })).toBe('thinking')
  })
})

// ─── State coverage: every state has an escape hatch ─────────────

describe('state reachability', () => {
  it('every terminal state (idle/error) can reach thinking via SEND_MESSAGE', () => {
    expect(AGENT_TRANSITIONS.idle['SEND_MESSAGE']).toBe('thinking')
    expect(AGENT_TRANSITIONS.error['SEND_MESSAGE']).toBe('thinking')
  })

  it('every active state can reach idle via ABORT', () => {
    const activeStates: AgentState[] = [
      'thinking', 'running', 'compacting', 'waitingForUserInput',
    ]
    for (const s of activeStates) {
      expect(
        AGENT_TRANSITIONS[s]['ABORT'],
        `${s} should have ABORT → idle`
      ).toBe('idle')
    }
  })

  it('every state that can succeed has RESULT_SUCCESS → idle', () => {
    for (const s of ['thinking', 'running', 'compacting'] as const) {
      expect(AGENT_TRANSITIONS[s]['RESULT_SUCCESS']).toBe('idle')
    }
  })
})
