import { describe, expect, it } from 'vitest'
import { shallow } from 'zustand/shallow'
import { emptySlot } from '../src/renderer/store/agent-store'
import {
  buildSidebarSessionIndicators,
  getSidebarSessionAttention,
  projectSidebarSessionIndicator,
} from '../src/renderer/components/layout/sidebar-session-state'

describe('Sidebar session state projection', () => {
  it('projects only the state rendered by the session list', () => {
    expect(projectSidebarSessionIndicator({
      ...emptySlot(),
      agentState: 'running',
    })).toBe('running')
    expect(projectSidebarSessionIndicator({
      ...emptySlot(),
      agentState: 'running',
      permissionRequest: { id: 'permission-1', toolName: 'Write', input: {} },
      permissionQueue: [
        { id: 'permission-2', toolName: 'Edit', input: {} },
      ],
    })).toBe('permission:2')
    expect(projectSidebarSessionIndicator({
      ...emptySlot(),
      askUserRequest: {
        id: 'ask-1',
        questions: [],
      },
    })).toBe('askUser:1')
  })

  it('keeps the shallow projection equal when only message content changes', () => {
    const before = buildSidebarSessionIndicators(['session-1'], {
      'session-1': {
        ...emptySlot(),
        agentState: 'running',
        messages: [],
      },
    })
    const after = buildSidebarSessionIndicators(['session-1'], {
      'session-1': {
        ...emptySlot(),
        agentState: 'running',
        messages: [{
          id: 'streamed-text',
          kind: 'text',
          textContent: 'new content',
          toolCalls: [],
          phase: 'streaming',
          timestamp: 1,
        }],
      },
    })

    expect(shallow(before, after)).toBe(true)
  })

  it('decodes attention labels and counts', () => {
    expect(getSidebarSessionAttention('permission:3')).toEqual({
      type: 'permission',
      count: 3,
      label: '等待权限确认',
    })
    expect(getSidebarSessionAttention('askUser:2')).toEqual({
      type: 'askUser',
      count: 2,
      label: '等待你回答',
    })
    expect(getSidebarSessionAttention('running')).toBeNull()
  })
})
