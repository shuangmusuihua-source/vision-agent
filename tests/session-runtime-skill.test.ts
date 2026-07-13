import { describe, expect, it } from 'vitest'
import { SessionRuntimeController } from '../src/main/session-runtime'
import { createSessionEnvelope } from '../src/main/session-envelope'

describe('SessionRuntimeController Skill activity', () => {
  it('tracks whether a Skill is used by an active run', () => {
    const runtime = new SessionRuntimeController()
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'frontend-design',
      abortController: new AbortController(),
      envelope: createSessionEnvelope({
        context: 'editor',
        sessionId: 'session-1',
        workspacePath: '/workspace',
      }),
    })

    expect(runtime.isSkillActive('frontend-design')).toBe(true)
    expect(runtime.isSkillActive('frontend-slides')).toBe(false)

    runtime.cleanupRun('session-1', instanceId)
    expect(runtime.isSkillActive('frontend-design')).toBe(false)
  })
})
