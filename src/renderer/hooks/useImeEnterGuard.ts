import { useCallback, useRef } from 'react'

export const IME_ENTER_GRACE_MS = 100

export interface ImeCompositionState {
  active: boolean
  endedAt: number
}

interface ImeKeyboardState {
  isComposing: boolean
  keyCode: number
}

export function isImeConfirmation(
  event: ImeKeyboardState,
  composition: ImeCompositionState,
  now: number,
): boolean {
  return event.isComposing ||
    event.keyCode === 229 ||
    composition.active ||
    now - composition.endedAt < IME_ENTER_GRACE_MS
}

export function useImeEnterGuard(): {
  onCompositionStart: () => void
  onCompositionEnd: () => void
  isImeConfirm: (event: React.KeyboardEvent<HTMLInputElement>) => boolean
} {
  const compositionRef = useRef<ImeCompositionState>({
    active: false,
    endedAt: Number.NEGATIVE_INFINITY,
  })

  const onCompositionStart = useCallback(() => {
    compositionRef.current.active = true
  }, [])

  const onCompositionEnd = useCallback(() => {
    compositionRef.current = { active: false, endedAt: performance.now() }
  }, [])

  const isImeConfirm = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => (
    isImeConfirmation(event.nativeEvent, compositionRef.current, performance.now())
  ), [])

  return { onCompositionStart, onCompositionEnd, isImeConfirm }
}
