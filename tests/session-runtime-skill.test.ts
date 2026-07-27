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

  it('aborts and waits for every run owned by one workspace', async () => {
    const runtime = new SessionRuntimeController()
    const workspaceAAbort = new AbortController()
    const workspaceBAbort = new AbortController()
    const workspaceAInstance = runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: workspaceAAbort,
      envelope: createSessionEnvelope({
        context: 'editor',
        sessionId: 'session-a',
        workspacePath: '/workspace/a',
      }),
    })
    const workspaceBInstance = runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: workspaceBAbort,
      envelope: createSessionEnvelope({
        context: 'editor',
        sessionId: 'session-b',
        workspacePath: '/workspace/b',
      }),
    })

    const pending = runtime.abortWorkspaceAndWait('/workspace/a')
    expect(workspaceAAbort.signal.aborted).toBe(true)
    expect(workspaceBAbort.signal.aborted).toBe(false)

    runtime.cleanupRun('session-a', workspaceAInstance)
    await expect(pending).resolves.toEqual(['session-a'])

    runtime.cleanupRun('session-b', workspaceBInstance)
  })
})
