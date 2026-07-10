export const MAX_CRON_LINKED_URLS = 3

function normalizeCronLinkedUrl(value: string, index: number): string {
  const trimmed = value.trim()
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`第 ${index + 1} 个网址格式不正确`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`第 ${index + 1} 个网址仅支持 http 或 https`)
  }

  return parsed.toString()
}

export function normalizeCronLinkedUrls(values: readonly unknown[] | null | undefined): string[] {
  if (values == null) return []
  if (!Array.isArray(values)) throw new Error('关联网址必须是数组')

  const nonEmpty = values.filter((value) => (
    value != null && (typeof value !== 'string' || value.trim() !== '')
  ))
  if (nonEmpty.length > MAX_CRON_LINKED_URLS) {
    throw new Error(`最多只能关联 ${MAX_CRON_LINKED_URLS} 个网址`)
  }

  const normalized = nonEmpty.map((value, index) => {
    if (typeof value !== 'string') throw new Error(`第 ${index + 1} 个网址格式不正确`)
    return normalizeCronLinkedUrl(value, index)
  })

  return Array.from(new Set(normalized))
}

export function sanitizeCronLinkedUrls(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  const sanitized: string[] = []
  for (const value of values) {
    if (sanitized.length >= MAX_CRON_LINKED_URLS) break
    try {
      const [normalized] = normalizeCronLinkedUrls([value])
      if (normalized && !sanitized.includes(normalized)) sanitized.push(normalized)
    } catch {
      // Ignore malformed persisted values so one stale task cannot block app startup.
    }
  }
  return sanitized
}
