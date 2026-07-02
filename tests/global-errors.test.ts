import { describe, expect, it } from 'vitest'
import { getGlobalErrorMessage, isExpectedCancellation } from '../src/renderer/lib/global-errors'

describe('global renderer errors', () => {
  it('shows a concise Error message instead of a stack trace', () => {
    const error = new Error('save failed')
    error.stack = 'large internal stack'

    expect(getGlobalErrorMessage(error)).toBe('save failed')
  })

  it('safely formats non-Error rejection values', () => {
    expect(getGlobalErrorMessage('network failed')).toBe('network failed')
    expect(getGlobalErrorMessage({ code: 'E_FAIL' })).toBe('{"code":"E_FAIL"}')
    expect(getGlobalErrorMessage(undefined)).toBe('未知错误')
  })

  it('only treats AbortError as an expected cancellation', () => {
    const cancellation = new Error('cancelled')
    cancellation.name = 'AbortError'

    expect(isExpectedCancellation(cancellation)).toBe(true)
    expect(isExpectedCancellation(new Error('cancelled'))).toBe(false)
    expect(isExpectedCancellation('AbortError')).toBe(false)
  })
})
