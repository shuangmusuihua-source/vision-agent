import { describe, expect, it } from 'vitest'
import { isSafeSdkSessionId, normalizeSessionPage } from '../src/main/session-request-policy'

describe('session request policy', () => {
  it('accepts opaque SDK IDs without path syntax', () => {
    expect(isSafeSdkSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isSafeSdkSessionId('../../settings')).toBe(false)
    expect(isSafeSdkSessionId('/absolute/path')).toBe(false)
    expect(isSafeSdkSessionId('nested/session')).toBe(false)
  })

  it('clamps pagination to finite non-negative values', () => {
    expect(normalizeSessionPage(10_000, -20)).toEqual({ limit: 200, offset: 0 })
    expect(normalizeSessionPage(Number.POSITIVE_INFINITY, Number.NaN)).toEqual({ limit: 1, offset: 0 })
  })
})
