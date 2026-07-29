import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentIPCMessage,
  SessionMessagePage,
  SessionPageCursor,
} from '../shared/types'
import { isSafeSdkSessionId } from './session-request-policy'
import { resolveClaudeSessionJsonlPath } from './claude-session-path'
import { readJsonlTailPage } from './jsonl-tail-reader'
import { toAgentIPCMessage } from './message-converter'
import { getSessionRecordById } from './persistence/workspace-store'

type TranscriptAdapter = 'jsonl' | 'sdk'

type DecodedCursor = {
  adapter: TranscriptAdapter
  position: number
}

function emptyPage(limit: number): SessionMessagePage {
  return { messages: [], cursor: null, limit, hasMore: false }
}

function decodeCursor(cursor: SessionPageCursor): DecodedCursor | null {
  if (!cursor) return null
  const match = cursor.match(/^(jsonl|sdk):([1-9]\d*)$/)
  if (!match) throw new Error('Invalid session transcript cursor')
  const position = Number(match[2])
  if (!Number.isSafeInteger(position)) throw new Error('Invalid session transcript cursor')
  return { adapter: match[1] as TranscriptAdapter, position }
}

function encodeCursor(adapter: TranscriptAdapter, position: number): SessionPageCursor {
  return position > 0 ? `${adapter}:${position}` : null
}

function convertMessages(messages: unknown[]): AgentIPCMessage[] {
  const converted: AgentIPCMessage[] = []
  for (const message of messages) {
    const projected = toAgentIPCMessage(
      message as Parameters<typeof toAgentIPCMessage>[0],
    )
    if (projected) converted.push(projected)
  }
  return converted
}

async function loadJsonlPage(
  filePath: string,
  limit: number,
  position: number,
): Promise<SessionMessagePage> {
  const page = await readJsonlTailPage(filePath, limit, position)
  return {
    messages: convertMessages(page.records),
    cursor: page.hasMore ? encodeCursor('jsonl', page.offset) : null,
    limit,
    hasMore: page.hasMore,
  }
}

async function loadSdkPage(
  sdkSessionId: string,
  workingDirectory: string,
  limit: number,
  position?: number,
): Promise<SessionMessagePage> {
  const allMessages = await getSessionMessages(sdkSessionId, {
    includeSystemMessages: true,
    dir: workingDirectory,
  })
  const end = Math.min(position ?? allMessages.length, allMessages.length)
  const start = Math.max(0, end - limit)
  return {
    messages: convertMessages(allMessages.slice(start, end)),
    cursor: start > 0 ? encodeCursor('sdk', start) : null,
    limit,
    hasMore: start > 0,
  }
}

/**
 * Load one Workspace session transcript page.
 *
 * Pages are selected newest-first. Messages inside a page remain chronological.
 * The cursor is opaque outside this Module and pins all subsequent requests to
 * the Adapter that produced the first page.
 */
export async function loadSessionTranscriptPage(
  appSessionId: string,
  limit: number,
  cursor: SessionPageCursor,
): Promise<SessionMessagePage> {
  const record = getSessionRecordById(appSessionId)
  if (
    !record?.sdkSessionId
    || !isSafeSdkSessionId(record.sdkSessionId)
    || !record.workingDirectory
  ) {
    return emptyPage(limit)
  }

  const decoded = decodeCursor(cursor)
  if (decoded?.adapter === 'sdk') {
    return await loadSdkPage(
      record.sdkSessionId,
      record.workingDirectory,
      limit,
      decoded.position,
    )
  }

  const jsonlPath = resolveClaudeSessionJsonlPath(record.sdkSessionId)
  if (decoded?.adapter === 'jsonl') {
    if (!jsonlPath) throw new Error('Session transcript JSONL is no longer available')
    return await loadJsonlPage(jsonlPath, limit, decoded.position)
  }

  if (jsonlPath) {
    try {
      return await loadJsonlPage(jsonlPath, limit, 0)
    } catch (error) {
      console.warn(
        '[SessionTranscript] Initial JSONL read failed, using SDK Adapter:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return await loadSdkPage(record.sdkSessionId, record.workingDirectory, limit)
}
