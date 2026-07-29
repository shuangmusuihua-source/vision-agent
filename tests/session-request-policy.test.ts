import { describe, expect, it } from 'vitest'
import {
  isSafeAppSessionId,
  isSafeSdkSessionId,
  normalizeSessionPage,
} from '../src/main/session-request-policy'

describe('session request policy', () => {
  it('accepts opaque SDK IDs without path syntax', () => {
    expect(isSafeSdkSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isSafeSdkSessionId('../../settings')).toBe(false)
    expect(isSafeSdkSessionId('/absolute/path')).toBe(false)
    expect(isSafeSdkSessionId('nested/session')).toBe(false)
  })

  it('accepts generated app session IDs without path syntax', () => {
    expect(isSafeAppSessionId('new-editor-1720000000000')).toBe(true)
    expect(isSafeAppSessionId('new-ask-1720000000000')).toBe(true)
    expect(isSafeAppSessionId('')).toBe(false)
    expect(isSafeAppSessionId('../session')).toBe(false)
  })

  it('clamps page size and accepts only Main-issued cursors', () => {
    expect(normalizeSessionPage(10_000, null)).toEqual({ limit: 200, cursor: null })
    expect(normalizeSessionPage(Number.POSITIVE_INFINITY, undefined)).toEqual({
      limit: 1,
      cursor: null,
    })
    expect(normalizeSessionPage(10, 'jsonl:42')).toEqual({ limit: 10, cursor: 'jsonl:42' })
    expect(normalizeSessionPage(10, 'sdk:8')).toEqual({ limit: 10, cursor: 'sdk:8' })
    expect(normalizeSessionPage(10, 'sdk:0')).toBeNull()
    expect(normalizeSessionPage(10, 'unknown:8')).toBeNull()
    expect(normalizeSessionPage(10, -20)).toBeNull()
  })
})
