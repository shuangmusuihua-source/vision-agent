import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  records: [{
    id: 'app-session-a',
    sdkSessionId: 'sdk-session-a',
    workspacePath: '/workspace',
    workingDirectory: '/workspace/.sumi/sessions/session-a',
    context: 'editor',
    status: 'idle',
    title: 'Session A',
    createdAt: 1,
    lastModified: 2,
    messageCount: 1,
  }],
  listSessions: vi.fn(),
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  removeSessionRecord: vi.fn(),
  updateSessionRecord: vi.fn(),
  deleteCompactionSessionId: vi.fn(),
  removeSessionWorkingDirectory: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: mocks.listSessions,
  getSessionMessages: vi.fn(),
  renameSession: mocks.renameSession,
  deleteSession: mocks.deleteSession,
}))

vi.mock('../src/main/persistence/workspace-store', () => ({
  getSessionRecords: () => mocks.records,
  removeSessionRecord: mocks.removeSessionRecord,
  updateSessionRecord: mocks.updateSessionRecord,
}))

vi.mock('../src/main/persistence/settings-store', () => ({
  getCompactionSessionIds: () => [],
  deleteCompactionSessionId: mocks.deleteCompactionSessionId,
}))

vi.mock('../src/main/skill-init', () => ({
  getAppSkillsCwd: () => '/app/skills',
}))

vi.mock('../src/main/message-converter', () => ({
  toAgentIPCMessage: vi.fn(() => null),
}))

vi.mock('../src/main/claude-session-path', () => ({
  resolveClaudeSessionJsonlPath: vi.fn(() => null),
}))

vi.mock('../src/main/jsonl-tail-reader', () => ({
  readJsonlTailPage: vi.fn(),
}))

vi.mock('../src/main/session-files', () => ({
  removeSessionWorkingDirectory: mocks.removeSessionWorkingDirectory,
}))

const { deleteSdkSession, listSdkSessions, renameSdkSession } = await import('../src/main/session-store')

beforeEach(() => {
  mocks.records = [{
    id: 'app-session-a',
    sdkSessionId: 'sdk-session-a',
    workspacePath: '/workspace',
    workingDirectory: '/workspace/.sumi/sessions/session-a',
    context: 'editor',
    status: 'idle',
    title: 'Session A',
    createdAt: 1,
    lastModified: 2,
    messageCount: 1,
  }]
  mocks.listSessions.mockReset()
  mocks.renameSession.mockReset()
  mocks.deleteSession.mockReset()
  mocks.removeSessionRecord.mockReset()
  mocks.updateSessionRecord.mockReset()
  mocks.deleteCompactionSessionId.mockReset()
  mocks.removeSessionWorkingDirectory.mockReset()
  mocks.removeSessionWorkingDirectory.mockResolvedValue(true)
  mocks.listSessions.mockResolvedValue([
    {
      sessionId: 'sdk-session-a',
      customTitle: 'SDK generated summary',
      createdAt: 1,
      lastModified: 2,
    },
    {
      sessionId: 'untracked-sdk-session',
      customTitle: 'External session',
      createdAt: 1,
      lastModified: 2,
    },
  ])
})

describe('session store isolation', () => {
  it('lists only app-owned sessions from their dedicated directory', async () => {
    const sessions = await listSdkSessions('/workspace')

    expect(mocks.listSessions).toHaveBeenCalledTimes(1)
    expect(mocks.listSessions).toHaveBeenCalledWith({
      dir: '/workspace/.sumi/sessions/session-a',
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace',
      title: 'Session A',
    })
  })

  it('returns sessions in stable newest-created-first order', async () => {
    mocks.records = [
      { ...mocks.records[0], id: 'older-app', sdkSessionId: 'older-sdk', createdAt: 10, workingDirectory: '/workspace/.sumi/sessions/older' },
      { ...mocks.records[0], id: 'newer-app', sdkSessionId: 'newer-sdk', createdAt: 20, workingDirectory: '/workspace/.sumi/sessions/newer' },
    ]
    mocks.listSessions.mockImplementation(async ({ dir }: { dir: string }) => [{
      sessionId: dir.endsWith('/newer') ? 'newer-sdk' : 'older-sdk',
      customTitle: 'SDK title',
      createdAt: 999,
      lastModified: 999,
    }])

    const sessions = await listSdkSessions('/workspace')

    expect(sessions.map((session) => session.id)).toEqual(['newer-app', 'older-app'])
  })

  it('deletes app-owned files and metadata even when SDK history is missing', async () => {
    mocks.deleteSession.mockRejectedValueOnce(new Error('Session not found'))

    await expect(deleteSdkSession('app-session-a')).resolves.toBeUndefined()

    expect(mocks.removeSessionWorkingDirectory).toHaveBeenCalledWith(
      '/workspace',
      '/workspace/.sumi/sessions/session-a',
      'editor',
    )
    expect(mocks.removeSessionRecord).toHaveBeenCalledWith('app-session-a')
  })

  it('persists an empty session title without requiring SDK history', async () => {
    mocks.records = [{
      ...mocks.records[0],
      id: 'new-session',
      sdkSessionId: undefined,
      status: 'empty',
    }]

    await expect(renameSdkSession('new-session', '新名称')).resolves.toBeUndefined()

    expect(mocks.updateSessionRecord).toHaveBeenCalledWith('new-session', expect.objectContaining({
      title: '新名称',
    }))
    expect(mocks.renameSession).not.toHaveBeenCalled()
  })
})
