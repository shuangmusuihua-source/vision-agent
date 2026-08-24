import { describe, expect, it } from 'vitest'
import {
  IME_ENTER_GRACE_MS,
  isImeConfirmation,
  type ImeCompositionState,
} from '../src/renderer/hooks/useImeEnterGuard'

const idleComposition: ImeCompositionState = {
  active: false,
  endedAt: Number.NEGATIVE_INFINITY,
}

describe('IME Enter guard', () => {
  it('allows an ordinary Enter outside composition', () => {
    expect(isImeConfirmation(
      { isComposing: false, keyCode: 13 },
      idleComposition,
      1_000,
    )).toBe(false)
  })

  it('blocks Enter while the browser reports composition', () => {
    expect(isImeConfirmation(
      { isComposing: true, keyCode: 13 },
      idleComposition,
      1_000,
    )).toBe(true)
  })

  it('blocks the legacy IME key code used by macOS input methods', () => {
    expect(isImeConfirmation(
      { isComposing: false, keyCode: 229 },
      idleComposition,
      1_000,
    )).toBe(true)
  })

  it('blocks Enter while the local composition state is active', () => {
    expect(isImeConfirmation(
      { isComposing: false, keyCode: 13 },
      { active: true, endedAt: Number.NEGATIVE_INFINITY },
      1_000,
    )).toBe(true)
  })

  it('keeps a short guard window after compositionend', () => {
    const composition = { active: false, endedAt: 1_000 }

    expect(isImeConfirmation(
      { isComposing: false, keyCode: 13 },
      composition,
      1_000 + IME_ENTER_GRACE_MS - 1,
    )).toBe(true)
    expect(isImeConfirmation(
      { isComposing: false, keyCode: 13 },
      composition,
      1_000 + IME_ENTER_GRACE_MS,
    )).toBe(false)
  })
})
