import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockState = {
  sessions: unknown[]
  sessionArtifacts: unknown[]
  authorizedDirectories: string[]
  fixedDirectories: string[]
  workspaces: unknown[]
}

const mockState: MockState = {
  sessions: [],
  sessionArtifacts: [],
  authorizedDirectories: [],
  fixedDirectories: [],
  workspaces: [],
}

vi.mock('../src/main/persistence/store-core', () => ({
  store: {
    get: vi.fn((key: keyof MockState) => mockState[key]),
    set: vi.fn((key: keyof MockState, value: MockState[keyof MockState]) => {
      mockState[key] = value as never
    }),
  },
  getKnowledgeBaseDir: vi.fn(() => '/knowledge'),
}))

const { getSessionRecords, updateSessionRecord } = await import('../src/main/persistence/workspace-store')

describe('session record persistence', () => {
  beforeEach(() => {
    mockState.sessions = []
    mockState.sessionArtifacts = []
    mockState.authorizedDirectories = []
    mockState.fixedDirectories = []
    mockState.workspaces = []
  })

  it('creates a session record when updating a new empty session with required metadata', () => {
    updateSessionRecord('new-123', {
      title: 'draft',
      workspacePath: '/workspace',
      context: 'editor',
      status: 'empty',
      createdAt: 10,
      lastModified: 10,
      messageCount: 0,
      artifactCount: 0,
    })

    expect(getSessionRecords()).toEqual([
      {
        id: 'new-123',
        title: 'draft',
        workspacePath: '/workspace',
        context: 'editor',
        status: 'empty',
        createdAt: 10,
        lastModified: 10,
        messageCount: 0,
        artifactCount: 0,
      },
    ])
  })

  it('does not create an incomplete session record', () => {
    updateSessionRecord('new-123', { title: 'draft' })

    expect(getSessionRecords()).toEqual([])
  })
})
