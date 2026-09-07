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

it('cancels queued preparation by SDK identity and waits for cleanup', async () => {
  const runtime = new SessionRuntimeController()
  const envelope = createSessionEnvelope({ context: 'editor', sessionId: 'a', sdkSessionId: 'sdk-a', workspacePath: '/a' })
  const first = await runtime.acquireSessionStart('a', envelope)
  const queued = runtime.acquireSessionStart('a', envelope)
  let stopped = false
  const stopping = runtime.abortAndWait('sdk-a').then(() => { stopped = true })
  expect(first.signal.aborted).toBe(true)
  first.release()
  const second = await queued
  expect(second.signal.aborted).toBe(true)
  expect(stopped).toBe(false)
  second.release()
  await stopping
  expect(stopped).toBe(true)
  const retry = await runtime.acquireSessionStart('a', envelope)
  expect(retry.signal.aborted).toBe(false)
  retry.release()
})

it('cancels preparation only in the workspace being deleted', async () => {
  const runtime = new SessionRuntimeController()
  const first = await runtime.acquireSessionStart('a', createSessionEnvelope({ context: 'editor', sessionId: 'a', workspacePath: '/a' }))
  const second = await runtime.acquireSessionStart('b', createSessionEnvelope({ context: 'editor', sessionId: 'b', workspacePath: '/b' }))
  const stopping = runtime.abortWorkspaceAndWait('/a')
  expect(first.signal.aborted).toBe(true)
  expect(second.signal.aborted).toBe(false)
  first.release()
  await expect(stopping).resolves.toEqual(['a'])
  second.release()
})
