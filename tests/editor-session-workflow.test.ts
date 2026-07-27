import { describe, expect, it, vi } from 'vitest'
import { EditorSessionWorkflow } from '../src/renderer/workflows/editor-session-workflow'

function createHarness() {
  let activeWorkspacePath: string | null = '/workspace/a'
  let activeSessionId: string | null = 'session-a'
  let view: 'editor' | 'ask' = 'editor'
  const events: string[] = []
  const loadSessions = vi.fn(async () => {})
  const persistNewSession = vi.fn(async () => ({ success: true }))
  const renameSession = vi.fn(async () => ({ success: true }))
  const deleteSdkSession = vi.fn(async () => ({ success: true }))
  const removeSessionRecord = vi.fn(async () => ({ success: true }))
  const alert = vi.fn(async () => {})
  const workflow = new EditorSessionWorkflow({
    getActiveWorkspacePath: () => activeWorkspacePath,
    getActiveSessionId: () => activeSessionId,
    getView: () => view,
    loadSessions,
    persistNewSession,
    renameSession,
    deleteSdkSession,
    removeSessionRecord,
    resolveSdkSessionId: (sessionId) => sessionId.startsWith('new-') ? null : `sdk-${sessionId}`,
    switchToSession: (sessionId, workspacePath) => {
      events.push(`switch:${sessionId}:${workspacePath || ''}`)
      activeSessionId = sessionId || null
    },
    setActiveWorkspace: (workspacePath) => {
      events.push(`workspace:${workspacePath}`)
      activeWorkspacePath = workspacePath
    },
    setUiLinkedFile: (filePath) => events.push(`ui-linked:${filePath || ''}`),
    clearEditorLinkedFile: () => events.push('clear-linked'),
    restoreSessionLinkedFile: () => events.push('restore-linked'),
    addTemporarySession: (sessionId, title, workspacePath) => (
      events.push(`add:${sessionId}:${title}:${workspacePath}`)
    ),
    renameSessionInList: (sessionId, title) => events.push(`rename:${sessionId}:${title}`),
    removeSessionState: (sessionId) => events.push(`remove:${sessionId}`),
    clearSessionOutputs: () => events.push('clear-outputs'),
    showEditor: () => {
      events.push('show-editor')
      view = 'editor'
    },
    selectExistingOverview: () => events.push('select-overview'),
    openOverview: () => events.push('open-overview'),
    finishDraft: () => events.push('finish-draft'),
    confirmDelete: async () => true,
    alert,
    createTemporarySessionId: () => 'new-1',
    logError: (operation) => events.push(`error:${operation}`),
  })

  return {
    workflow,
    events,
    loadSessions,
    persistNewSession,
    renameSession,
    deleteSdkSession,
    removeSessionRecord,
    alert,
    setView: (next: 'editor' | 'ask') => { view = next },
    setActiveSessionId: (next: string | null) => { activeSessionId = next },
  }
}

describe('editor session workflow module', () => {
  it('selects a session through the slot, workspace, view, and overview seam', () => {
    const harness = createHarness()
    harness.setView('ask')

    harness.workflow.select('session-b', '/workspace/b')

    expect(harness.events).toEqual([
      'switch:session-b:/workspace/b',
      'restore-linked',
      'workspace:/workspace/b',
      'show-editor',
      'select-overview',
    ])
  })

  it('persists a new session before exposing it and skips the resulting workspace reload', async () => {
    const harness = createHarness()

    await expect(harness.workflow.create('/workspace/b', '  Research  ')).resolves.toBe(true)
    expect(harness.persistNewSession).toHaveBeenCalledWith('new-1', 'Research', '/workspace/b')
    expect(harness.events).toEqual([
      'switch:new-1:/workspace/b',
      'clear-linked',
      'workspace:/workspace/b',
      'add:new-1:Research:/workspace/b',
      'finish-draft',
      'show-editor',
    ])

    harness.workflow.workspaceActivated()
    expect(harness.loadSessions).not.toHaveBeenCalled()
    harness.workflow.workspaceActivated()
    expect(harness.loadSessions).toHaveBeenCalledTimes(1)
  })

  it('does not expose a new session when durable persistence fails', async () => {
    const harness = createHarness()
    harness.persistNewSession.mockResolvedValueOnce({ success: false })

    await expect(harness.workflow.create('/workspace/b', 'Research')).resolves.toBe(false)

    expect(harness.events).toEqual(['error:create session'])
    expect(harness.alert).toHaveBeenCalledWith('创建失败', '无法保存新会话，请稍后重试')
  })

  it('deletes SDK-backed and temporary sessions through their owning adapters', async () => {
    const harness = createHarness()

    await expect(harness.workflow.remove('session-a')).resolves.toBe(true)
    expect(harness.deleteSdkSession).toHaveBeenCalledWith('sdk-session-a')
    expect(harness.events).toEqual([
      'remove:session-a',
      'switch::',
      'clear-outputs',
      'clear-linked',
      'show-editor',
    ])

    harness.setActiveSessionId('session-b')
    await expect(harness.workflow.remove('new-2')).resolves.toBe(true)
    expect(harness.removeSessionRecord).toHaveBeenCalledWith('new-2')
  })

  it('projects a rename only after persistence succeeds', async () => {
    const harness = createHarness()
    await expect(harness.workflow.rename('session-a', 'New title')).resolves.toBe(true)
    expect(harness.events).toEqual(['rename:session-a:New title'])

    harness.renameSession.mockResolvedValueOnce({ success: false })
    await expect(harness.workflow.rename('session-a', 'Rejected')).resolves.toBe(false)
    expect(harness.events).not.toContain('rename:session-a:Rejected')
    expect(harness.alert).toHaveBeenCalledWith('重命名失败', '无法保存会话名称，请稍后重试')
  })
})
