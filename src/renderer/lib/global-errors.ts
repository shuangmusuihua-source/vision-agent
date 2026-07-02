export function getGlobalErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name
  if (typeof reason === 'string') return reason

  try {
    const serialized = JSON.stringify(reason)
    if (serialized && serialized !== '{}') return serialized
  } catch {
    // Fall through to the safe generic message below.
  }

  return '未知错误'
}

export function isExpectedCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError'
}
