import { open, stat } from 'node:fs/promises'

export interface JsonlTailPage {
  records: Array<Record<string, unknown>>
  /** Opaque byte cursor. Pass it back to read the page immediately before this one. */
  offset: number
  hasMore: boolean
}

interface JsonlLine {
  start: number
  value: Buffer
}

const DEFAULT_CHUNK_SIZE = 64 * 1024

function splitCompleteLines(data: Buffer, absoluteStart: number, startsAtFileBeginning: boolean): {
  complete: JsonlLine[]
  partial: Buffer
} {
  const segments: Array<{ start: number; end: number }> = []
  let segmentStart = 0
  for (let index = 0; index < data.length; index++) {
    if (data[index] !== 0x0a) continue
    segments.push({ start: segmentStart, end: index })
    segmentStart = index + 1
  }
  if (segmentStart < data.length) {
    segments.push({ start: segmentStart, end: data.length })
  }

  const firstIsPartial = !startsAtFileBeginning && segments.length > 0 && segments[0].start === 0
  const partial = firstIsPartial ? data.subarray(segments[0].start, segments[0].end) : Buffer.alloc(0)
  const complete = segments
    .slice(firstIsPartial ? 1 : 0)
    .filter(({ start, end }) => end > start)
    .map(({ start, end }) => ({
      start: absoluteStart + start,
      value: data.subarray(start, end),
    }))

  return { complete, partial }
}

/**
 * Reads only enough bytes from the tail of an append-only JSONL file to fill
 * one page. The returned offset is intentionally opaque to callers.
 */
export async function readJsonlTailPage(
  filePath: string,
  limit: number,
  offset = 0,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<JsonlTailPage> {
  const pageSize = Math.max(1, Math.floor(limit))
  const fileSize = (await stat(filePath)).size
  const end = offset > 0 ? Math.min(offset, fileSize) : fileSize
  if (end <= 0) return { records: [], offset: 0, hasMore: false }

  const handle = await open(filePath, 'r')
  let cursor = end
  let partial: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let lines: JsonlLine[] = []

  try {
    while (cursor > 0 && lines.length <= pageSize) {
      const readStart = Math.max(0, cursor - chunkSize)
      const requested = cursor - readStart
      const chunk = Buffer.allocUnsafe(requested)
      const { bytesRead } = await handle.read(chunk, 0, requested, readStart)
      const data = Buffer.concat([chunk.subarray(0, bytesRead), partial])
      const split = splitCompleteLines(data, readStart, readStart === 0)
      partial = split.partial
      lines = [...split.complete, ...lines]
      cursor = readStart
    }
  } finally {
    await handle.close()
  }

  const selected = lines.slice(-pageSize)
  const records: Array<Record<string, unknown>> = []
  for (const line of selected) {
    try {
      const parsed = JSON.parse(line.value.toString('utf8'))
      if (parsed && typeof parsed === 'object') records.push(parsed as Record<string, unknown>)
    } catch {
      // A malformed historical line should not make the entire session unreadable.
    }
  }

  const nextOffset = selected[0]?.start ?? 0
  return {
    records,
    offset: nextOffset,
    hasMore: nextOffset > 0,
  }
}
