import { describe, expect, it } from 'vitest'
import { emptySlot } from '../src/renderer/store/agent-store'
import { reduceAgentEvent } from '../src/renderer/store/agent-state-machine'

function activeTextMessage() {
  return {
    kind: 'text' as const,
    id: 'answer-1',
    role: 'assistant' as const,
    phase: 'streaming' as const,
    textContent: '```skill-output\n<h1>Done</h1>\n```',
    content: [],
    toolCalls: [],
    createdAt: 1,
    skillMeta: { id: 'skill-1', name: 'Skill', icon: 'spark', status: 'running' as const },
  }
}

describe('reduceAgentEvent', () => {
  it('finalizes successful sessions and appends artifacts immutably', () => {
    const processedArtifactIds = new Set<string>()
    const slot = {
      ...emptySlot(),
      agentState: 'running' as const,
      isStreaming: true,
      activeSkillId: 'skill-1',
      messages: [activeTextMessage()],
      _processedArtifactIds: processedArtifactIds,
    }

    const patch = reduceAgentEvent(slot, { type: 'RESULT_SUCCESS' })

    expect(patch.agentState).toBe('idle')
    expect(patch.isStreaming).toBe(false)
    expect(patch.messages?.[0]).toMatchObject({
      phase: 'complete',
      skillMeta: { status: 'completed' },
    })
    expect(patch.messages?.[1]).toMatchObject({ kind: 'artifact' })
    expect(processedArtifactIds.size).toBe(0)
    expect(patch._processedArtifactIds).not.toBe(processedArtifactIds)
    expect(patch._processedArtifactIds?.has('answer-1')).toBe(true)
  })

  it('clears interaction state and marks active output as errored', () => {
    const slot = {
      ...emptySlot(),
      agentState: 'running' as const,
      isStreaming: true,
      activeSkillId: 'skill-1',
      messages: [activeTextMessage()],
      permissionRequest: { id: 'permission-1', toolName: 'Write', input: {} },
      askUserRequest: { id: 'ask-1', questions: [] },
    }

    const patch = reduceAgentEvent(slot, { type: 'RESULT_ERROR' })

    expect(patch.agentState).toBe('error')
    expect(patch.isStreaming).toBe(false)
    expect(patch.permissionRequest).toBeNull()
    expect(patch.askUserRequest).toBeNull()
    expect(patch.messages?.[0]).toMatchObject({
      phase: 'error',
      skillMeta: { status: 'error' },
    })
  })

  it('records the abort guard and completes in-flight output', () => {
    const slot = {
      ...emptySlot(),
      agentState: 'thinking' as const,
      isStreaming: true,
      messages: [activeTextMessage()],
      _queryGeneration: 4,
    }

    const patch = reduceAgentEvent(slot, { type: 'ABORT' })

    expect(patch.agentState).toBe('idle')
    expect(patch._resultGuardGen).toBe(4)
    expect(patch.isStreaming).toBe(false)
    expect(patch.messages?.[0]).toMatchObject({ phase: 'complete' })
  })
})
