import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelUsageDetail, ModelUsageSessionBreakdown, SessionRecord } from '../src/shared/types'
import type { IPCRequest } from '../src/shared/ipc-types'
import type { WorkspaceLifecycle } from '../src/main/workspace-lifecycle'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getSessionRecords: vi.fn<() => SessionRecord[]>(),
  getModelUsageDetail: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  nativeTheme: {},
}))
vi.mock('../src/main/persistence/profile-store', () => ({
  getSettings: vi.fn(), addProfile: vi.fn(), updateProfile: vi.fn(), removeProfile: vi.fn(),
  setActiveProfile: vi.fn(), getProfileIds: () => ['profile-1'],
}))
vi.mock('../src/main/persistence/settings-store', () => ({ setTheme: vi.fn() }))
vi.mock('../src/main/persistence/model-usage-store', () => ({
  getModelUsageDetail: mocks.getModelUsageDetail, getModelUsageSummaries: vi.fn(),
}))
vi.mock('../src/main/persistence/workspace-store', () => ({ getSessionRecords: mocks.getSessionRecords }))

import { registerSettingsHandlers } from '../src/main/handlers/settings-handlers'

function usage(sessionId: string, source: ModelUsageSessionBreakdown['source'] = 'interactive'): ModelUsageSessionBreakdown {
  return { sessionId, source, title: 'Recorded title', workspaceName: 'Recorded workspace',
    totalTokens: 100, requestCount: 1, costUSD: 0.1, lastUsedAt: 1 }
}

function record(id: string, title = 'Current title'): SessionRecord {
  return { id, title, context: 'editor', workspacePath: '/workspace/current', status: 'idle', createdAt: 1, lastModified: 1 }
}

function requestDetail(): ModelUsageDetail {
  const request: IPCRequest<'settings:getModelUsageDetail'> = { profileId: 'profile-1', range: 'all' }
  return mocks.handlers.get('settings:getModelUsageDetail')!(null, request)
}

describe('model usage detail IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerSettingsHandlers(vi.fn(), {} as WorkspaceLifecycle)
  })

  it('reads one session snapshot for a large detail and refreshes it for the next request', () => {
    const sessions = Array.from({ length: 1_000 }, (_, i) => usage(`session-${i}`))
    const records = sessions.map((s) => record(s.sessionId))
    mocks.getSessionRecords.mockReturnValue(records)
    mocks.getModelUsageDetail.mockReturnValue({ sessions })

    const detail = requestDetail()
    expect(mocks.getSessionRecords).toHaveBeenCalledOnce()
    expect(detail.sessions).toHaveLength(1_000)
    expect(detail.sessions.every((s) => s.title === 'Current title' && s.workspaceName === 'current')).toBe(true)

    mocks.getSessionRecords.mockReturnValue([record('session-0', 'Renamed')])
    expect(requestDetail().sessions[0].title).toBe('Renamed')
    expect(mocks.getSessionRecords).toHaveBeenCalledTimes(2)
  })

  it('preserves missing and non-interactive session metadata and labels Ask sessions', () => {
    const sessions = [usage('ask'), usage('untitled'), usage('removed'), usage('cron', 'automation')]
    mocks.getModelUsageDetail.mockReturnValue({ sessions })
    mocks.getSessionRecords.mockReturnValue([
      { ...record('ask'), context: 'ask' }, record('untitled', ''), record('cron'),
    ])
    expect(requestDetail().sessions).toEqual([
      { ...sessions[0], title: 'Current title', workspaceName: 'Ask sumi' },
      { ...sessions[1], workspaceName: 'current' }, sessions[2], sessions[3],
    ])
  })
})
