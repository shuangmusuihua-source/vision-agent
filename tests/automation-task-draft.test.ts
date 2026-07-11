import { describe, expect, it } from 'vitest'
import type { SdkSessionInfo } from '../src/shared/types'
import {
  automationTaskDraftReducer,
  buildAutomationRegistration,
  buildAutomationTarget,
  createAutomationTaskDraft,
  cronToNaturalLanguage,
  deriveAutomationTaskDraft,
  resolvedCustomCron,
} from '../src/renderer/automation/automation-task-draft'

const sessions: SdkSessionInfo[] = [{
  id: 'session-a',
  sdkSessionId: 'sdk-a',
  title: 'Research',
  workspacePath: '/workspace/research',
  context: 'editor',
}]

describe('automation task draft module', () => {
  it('creates and synchronizes defaults without overwriting user choices', () => {
    let draft = createAutomationTaskDraft()
    draft = automationTaskDraftReducer(draft, {
      type: 'syncDefaults',
      sessionId: 'session-a',
      workspacePath: '/workspace/a',
    })
    expect(draft.selectedSessionId).toBe('session-a')
    expect(draft.selectedWorkspacePath).toBe('/workspace/a')

    draft = automationTaskDraftReducer(draft, {
      type: 'syncDefaults',
      sessionId: 'session-b',
      workspacePath: '/workspace/b',
    })
    expect(draft.selectedSessionId).toBe('session-a')
    expect(draft.selectedWorkspacePath).toBe('/workspace/a')
  })

  it('owns URL field limits and editing transitions', () => {
    let draft = createAutomationTaskDraft()
    draft = automationTaskDraftReducer(draft, { type: 'addUrl' })
    draft = automationTaskDraftReducer(draft, { type: 'addUrl' })
    draft = automationTaskDraftReducer(draft, { type: 'addUrl' })
    expect(draft.linkedUrlInputs).toHaveLength(3)

    draft = automationTaskDraftReducer(draft, { type: 'updateUrl', index: 1, value: 'example.com' })
    expect(draft.linkedUrlInputs[1]).toBe('example.com')
    draft = automationTaskDraftReducer(draft, { type: 'removeUrl', index: 1 })
    expect(draft.linkedUrlInputs).toHaveLength(2)
  })

  it('invalidates a resolved custom schedule when its source text changes', () => {
    let draft = createAutomationTaskDraft()
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'frequencyMode', value: 'custom' })
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'customScheduleText', value: '每周一上午九点' })
    draft = automationTaskDraftReducer(draft, {
      type: 'scheduleResolved',
      input: '每周一上午九点',
      cronExpression: '0 9 * * 1',
    })
    expect(resolvedCustomCron(draft)).toBe('0 9 * * 1')

    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'customScheduleText', value: '每周二上午九点' })
    expect(resolvedCustomCron(draft)).toBe('')
    expect(deriveAutomationTaskDraft(draft).schedulePreviewLabel).toBe('等待解析执行频率')
  })

  it('derives schedule, URL validation, and create readiness together', () => {
    let draft = createAutomationTaskDraft()
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'prompt', value: 'Summarize updates' })
    draft = automationTaskDraftReducer(draft, { type: 'updateUrl', index: 0, value: 'example.com/report' })

    const derived = deriveAutomationTaskDraft(draft)
    expect(derived.cronExpression).toBe('0 9 * * *')
    expect(derived.scheduleLabel).toBe('每天 上午 9:00')
    expect(derived.linkedUrls).toEqual(['https://example.com/report'])
    expect(derived.canCreate).toBe(true)

    draft = automationTaskDraftReducer(draft, { type: 'updateUrl', index: 0, value: 'ftp://example.com' })
    expect(deriveAutomationTaskDraft(draft)).toMatchObject({
      linkedUrlError: '第 1 个网址仅支持 http 或 https',
      canCreate: false,
    })
  })

  it('builds each target mode behind the same interface', () => {
    let draft = createAutomationTaskDraft('session-a', '/workspace/research')
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'targetMode', value: 'session' })
    expect(buildAutomationTarget(draft, sessions, null)).toMatchObject({
      type: 'session',
      sessionId: 'session-a',
      sessionTitle: 'Research',
      workspacePath: '/workspace/research',
    })

    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'targetMode', value: 'workspace' })
    expect(buildAutomationTarget(draft, sessions, null)).toEqual({
      type: 'workspace',
      workspacePath: '/workspace/research',
      workspaceName: 'research',
    })

    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'targetMode', value: 'directory' })
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'selectedDirectoryPath', value: '/tmp/reports' })
    expect(buildAutomationTarget(draft, sessions, null)).toEqual({
      type: 'directory',
      directoryPath: '/tmp/reports',
      workspaceName: 'reports',
    })
  })

  it('builds a normalized registration and enables network for linked URLs', () => {
    let draft = createAutomationTaskDraft('session-a', '/workspace/research')
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'name', value: 'Digest' })
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'prompt', value: 'Write a digest' })
    draft = automationTaskDraftReducer(draft, { type: 'set', field: 'targetMode', value: 'session' })
    draft = automationTaskDraftReducer(draft, { type: 'updateUrl', index: 0, value: 'example.com' })

    expect(buildAutomationRegistration(draft, sessions, null)).toEqual({
      name: 'Digest',
      prompt: 'Write a digest',
      cronExpression: '0 9 * * *',
      target: expect.objectContaining({ type: 'session', sessionId: 'session-a' }),
      linkedUrls: ['https://example.com/'],
      allowNetwork: true,
      notifyOnCompletion: true,
    })
  })

  it('formats common cron expressions for display', () => {
    expect(cronToNaturalLanguage('*/30 * * * *')).toBe('每 30 分钟')
    expect(cronToNaturalLanguage('0 15 * * 3')).toBe('每周三 下午 3:00')
  })
})
