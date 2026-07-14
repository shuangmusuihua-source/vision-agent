import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GenerationActivityProjector,
  MAX_GENERATION_PREVIEW_CHARS,
  extractPartialJsonStringValues,
} from '../src/main/generation-activity-projector'
import { createSessionEnvelope } from '../src/main/session-envelope'
import type { SessionRoutedGenerationActivity } from '../src/shared/types'

function streamEvent(event: Record<string, unknown>, uuid = 'stream-message') {
  return {
    type: 'stream_event',
    uuid,
    session_id: 'sdk-session',
    parent_tool_use_id: null,
    event,
  } as never
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GenerationActivityProjector', () => {
  it('decodes fragmented streamed JSON strings including escapes and unicode', () => {
    expect(extractPartialJsonStringValues(
      '{"file_path":"report.md","content":"line 1\\nquote: \\"yes\\"\\u4f60',
      'content',
    )).toEqual(['line 1\nquote: "yes"你'])
  })

  it('emits preparing immediately before any generated content arrives', () => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }), 'slides')

    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start',
      index: 3,
      content_block: { type: 'tool_use', id: 'write-1', name: 'Write', input: {} },
    }), 'slides')

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      activityId: 'tool:write-1',
      phase: 'preparing',
      content: '',
      sessionId: 'app-session',
    })
  })

  it('routes parallel tool deltas by content block index without mixing them', () => {
    vi.useFakeTimers()
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }), 'slides')

    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 1,
      content_block: { type: 'tool_use', id: 'write-a', name: 'Write', input: {} },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 2,
      content_block: { type: 'tool_use', id: 'edit-b', name: 'Edit', input: {} },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.md","content":"# Alpha"}' },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({ type: 'content_block_stop', index: 1 }), 'slides')
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"b.html","new_string":"<h1>Beta</h1>"}' },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({ type: 'content_block_stop', index: 2 }), 'slides')

    const alpha = activities.find((activity) => activity.activityId === 'tool:write-a' && activity.phase === 'finalizing')
    const beta = activities.find((activity) => activity.activityId === 'tool:edit-b' && activity.phase === 'finalizing')
    expect(alpha).toMatchObject({ content: '# Alpha', language: 'markdown' })
    expect(beta).toMatchObject({ content: '<h1>Beta</h1>', language: 'html' })
  })

  it('keeps Bash activity visible without presenting its command as generated content', () => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }), 'slides')

    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'bash-1', name: 'Bash', input: {} },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"python build.py"}' },
    }), 'slides')
    projector.processRawMessage('app-session', streamEvent({ type: 'content_block_stop', index: 0 }), 'slides')

    expect(activities.at(-1)).toMatchObject({
      activityId: 'tool:bash-1',
      phase: 'finalizing',
      label: '正在执行生成任务',
      content: '',
    })
  })

  it('does not classify an ordinary Bash call as artifact generation', () => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }))

    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'bash-1', name: 'Bash', input: {} },
    }), null)

    expect(activities).toEqual([])
  })

  it('emits a terminal phase when the tool finishes', () => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }))
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'write-1', name: 'Write', input: {} },
    }), null)

    projector.finishTool('app-session', 'write-1', 'completed')

    expect(activities.at(-1)).toMatchObject({ activityId: 'tool:write-1', phase: 'completed' })
  })

  it.each(['failed', 'cancelled'] as const)('emits %s when the session terminates', (phase) => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }))
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'write-1', name: 'Write', input: {} },
    }), null)

    projector.finishSession('app-session', phase)

    expect(activities.at(-1)).toMatchObject({ activityId: 'tool:write-1', phase })
  })

  it('recognizes a skill-output fence split across text deltas', () => {
    vi.useFakeTimers()
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }), 'slides')

    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: '```skill-' },
    }, 'message-1'), 'slides')
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: 'output\n# Report' },
    }, 'message-1'), 'slides')
    vi.advanceTimersByTime(80)

    expect(activities.at(-1)).toMatchObject({
      activityId: 'skill-output:message-1',
      phase: 'generating',
      content: '# Report',
      language: 'markdown',
    })
  })

  it('bounds large streamed tool previews while preserving the final tail', () => {
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session',
      workspacePath: '/workspace',
    }))
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'large-write', name: 'Write', input: {} },
    }), null)

    const content = `${'a'.repeat(MAX_GENERATION_PREVIEW_CHARS * 2)}THE-END`
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_delta', index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify({ file_path: 'report.md', content }),
      },
    }), null)
    projector.processRawMessage('app-session', streamEvent({ type: 'content_block_stop', index: 0 }), null)

    expect(activities.every((activity) => activity.content.length <= MAX_GENERATION_PREVIEW_CHARS)).toBe(true)
    expect(activities.at(-1)?.content).toContain('THE-END')
    expect(activities.at(-1)?.content).toMatch(/^…已省略较早内容…/)
  })

  it('updates a small Write preview across fragmented JSON deltas', () => {
    vi.useFakeTimers()
    const activities: SessionRoutedGenerationActivity[] = []
    const projector = new GenerationActivityProjector()
    projector.setEmitter((activity) => activities.push(activity))
    projector.reset('app-session', createSessionEnvelope({
      context: 'editor', sessionId: 'app-session', workspacePath: '/workspace',
    }))
    projector.processRawMessage('app-session', streamEvent({
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'fragmented-write', name: 'Write', input: {} },
    }), null)
    for (const partial_json of ['{"file_path":"small.md",', '"content":"hello ', 'world"}']) {
      projector.processRawMessage('app-session', streamEvent({
        type: 'content_block_delta', index: 0,
        delta: { type: 'input_json_delta', partial_json },
      }), null)
    }
    vi.advanceTimersByTime(80)

    expect(activities.some((activity) => activity.phase === 'generating' && activity.content === 'hello world')).toBe(true)
  })
})
