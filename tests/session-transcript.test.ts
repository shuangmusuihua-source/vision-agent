import type { AgentIPCMessage } from '../src/shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: {
    id: 'app-session-a',
    sdkSessionId: 'sdk-session-a',
    workingDirectory: '/workspace/.sumi/sessions/session-a',
  },
  getSessionMessages: vi.fn(),
  resolveClaudeSessionJsonlPath: vi.fn(),
  readJsonlTailPage: vi.fn(),
  toAgentIPCMessage: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSessionMessages: mocks.getSessionMessages,
}))

vi.mock('../src/main/persistence/workspace-store', () => ({
  getSessionRecordById: (id: string) => id === mocks.record.id ? mocks.record : undefined,
}))

vi.mock('../src/main/claude-session-path', () => ({
  resolveClaudeSessionJsonlPath: mocks.resolveClaudeSessionJsonlPath,
}))

vi.mock('../src/main/jsonl-tail-reader', () => ({
  readJsonlTailPage: mocks.readJsonlTailPage,
}))

vi.mock('../src/main/message-converter', () => ({
  toAgentIPCMessage: mocks.toAgentIPCMessage,
}))

const { loadSessionTranscriptPage } = await import('../src/main/session-transcript')

function message(index: number): AgentIPCMessage {
  return {
    type: 'assistant',
    uuid: `message-${index}`,
    message: { content: [{ type: 'text', text: `Message ${index}` }] },
  }
}

beforeEach(() => {
  mocks.getSessionMessages.mockReset()
  mocks.resolveClaudeSessionJsonlPath.mockReset()
  mocks.readJsonlTailPage.mockReset()
  mocks.toAgentIPCMessage.mockReset()
  mocks.resolveClaudeSessionJsonlPath.mockReturnValue(null)
  mocks.toAgentIPCMessage.mockImplementation((value) => value)
})

describe('Workspace session transcript', () => {
  it('loads SDK pages newest-first while preserving chronological order within each page', async () => {
    mocks.getSessionMessages.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => message(index)),
    )

    const newest = await loadSessionTranscriptPage('app-session-a', 10, null)
    const middle = await loadSessionTranscriptPage('app-session-a', 10, newest.cursor)
    const oldest = await loadSessionTranscriptPage('app-session-a', 10, middle.cursor)

    expect(newest.messages.map((item) => item.uuid)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message-${index + 15}`),
    )
    expect(newest).toMatchObject({ cursor: 'sdk:15', limit: 10, hasMore: true })
    expect(middle.messages.map((item) => item.uuid)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message-${index + 5}`),
    )
    expect(middle).toMatchObject({ cursor: 'sdk:5', limit: 10, hasMore: true })
    expect(oldest.messages.map((item) => item.uuid)).toEqual(
      Array.from({ length: 5 }, (_, index) => `message-${index}`),
    )
    expect(oldest).toMatchObject({ cursor: null, limit: 10, hasMore: false })
    expect(mocks.getSessionMessages).toHaveBeenCalledWith('sdk-session-a', {
      includeSystemMessages: true,
      dir: '/workspace/.sumi/sessions/session-a',
    })
  })

  it('keeps subsequent pages on the JSONL Adapter that issued the cursor', async () => {
    mocks.resolveClaudeSessionJsonlPath.mockReturnValue('/sessions/sdk-session-a.jsonl')
    mocks.readJsonlTailPage
      .mockResolvedValueOnce({
        records: [message(15), message(16)],
        offset: 150,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        records: [message(5), message(6)],
        offset: 50,
        hasMore: false,
      })

    const newest = await loadSessionTranscriptPage('app-session-a', 10, null)
    const older = await loadSessionTranscriptPage('app-session-a', 10, newest.cursor)

    expect(newest).toMatchObject({ cursor: 'jsonl:150', hasMore: true })
    expect(older).toMatchObject({ cursor: null, hasMore: false })
    expect(mocks.readJsonlTailPage).toHaveBeenNthCalledWith(
      1,
      '/sessions/sdk-session-a.jsonl',
      10,
      0,
    )
    expect(mocks.readJsonlTailPage).toHaveBeenNthCalledWith(
      2,
      '/sessions/sdk-session-a.jsonl',
      10,
      150,
    )
    expect(mocks.getSessionMessages).not.toHaveBeenCalled()
  })

  it('falls back to the SDK Adapter only when the initial JSONL page cannot be read', async () => {
    mocks.resolveClaudeSessionJsonlPath.mockReturnValue('/sessions/sdk-session-a.jsonl')
    mocks.readJsonlTailPage.mockRejectedValueOnce(new Error('unreadable'))
    mocks.getSessionMessages.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => message(index)),
    )

    const page = await loadSessionTranscriptPage('app-session-a', 10, null)

    expect(page.messages.map((item) => item.uuid)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message-${index + 2}`),
    )
    expect(page).toMatchObject({ cursor: 'sdk:2', hasMore: true })
  })

  it('does not switch Adapters after a JSONL cursor has been issued', async () => {
    mocks.resolveClaudeSessionJsonlPath.mockReturnValue('/sessions/sdk-session-a.jsonl')
    mocks.readJsonlTailPage.mockRejectedValueOnce(new Error('unreadable'))

    await expect(
      loadSessionTranscriptPage('app-session-a', 10, 'jsonl:150'),
    ).rejects.toThrow('unreadable')
    expect(mocks.getSessionMessages).not.toHaveBeenCalled()
  })
})
