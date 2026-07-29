import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockState = {
  sessions: unknown[]
  authorizedDirectories: string[]
  fixedDirectories: string[]
  compactionSessionIds: string[]
}

const mockState: MockState = {
  sessions: [],
  authorizedDirectories: [],
  fixedDirectories: [],
  compactionSessionIds: [],
}

vi.mock('../src/main/persistence/store-core', () => ({
  store: {
    get store() {
      return mockState
    },
    set store(value: MockState) {
      Object.assign(mockState, value)
    },
    get: vi.fn((key: keyof MockState) => mockState[key]),
    set: vi.fn((
      key: keyof MockState | Partial<MockState>,
      value?: MockState[keyof MockState],
    ) => {
      if (typeof key === 'object') {
        Object.assign(mockState, key)
        return
      }
      mockState[key] = value as never
    }),
  },
  getKnowledgeBaseDir: vi.fn(() => '/knowledge'),
}))

const {
  getSessionRecords,
  removeWorkspacePersistence,
  updateSessionRecord,
} = await import('../src/main/persistence/workspace-store')

describe('session record persistence', () => {
  beforeEach(() => {
    mockState.sessions = []
    mockState.authorizedDirectories = []
    mockState.fixedDirectories = []
    mockState.compactionSessionIds = []
  })

  it('creates a session record when updating a new empty session with required metadata', () => {
    updateSessionRecord('new-123', {
      title: 'draft',
      workspacePath: '/workspace',
      workingDirectory: '/workspace/.sumi/sessions/session-a',
      context: 'editor',
      status: 'empty',
      createdAt: 10,
      lastModified: 10,
    })

    expect(getSessionRecords()).toEqual([
      {
        id: 'new-123',
        title: 'draft',
        workspacePath: '/workspace',
        workingDirectory: '/workspace/.sumi/sessions/session-a',
        context: 'editor',
        status: 'empty',
        createdAt: 10,
        lastModified: 10,
      },
    ])
  })

  it('does not create an incomplete session record', () => {
    updateSessionRecord('new-123', { title: 'draft' })

    expect(getSessionRecords()).toEqual([])
  })

  it('removes workspace authorization and app-owned sessions together', () => {
    mockState.authorizedDirectories = ['/workspace/a', '/workspace/b']
    mockState.sessions = [
      { id: 'session-a', sdkSessionId: 'sdk-a', workspacePath: '/workspace/a' },
      { id: 'session-b', sdkSessionId: 'sdk-b', workspacePath: '/workspace/b' },
    ]
    mockState.compactionSessionIds = ['sdk-a', 'sdk-b']

    expect(removeWorkspacePersistence('/workspace/a')).toEqual({
      removedSessionIds: ['session-a'],
    })
    expect(mockState.authorizedDirectories).toEqual(['/workspace/b'])
    expect(mockState.sessions).toEqual([
      { id: 'session-b', sdkSessionId: 'sdk-b', workspacePath: '/workspace/b' },
    ])
    expect(mockState.compactionSessionIds).toEqual(['sdk-a', 'sdk-b'])
  })
})
