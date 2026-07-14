export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function isAllowedRendererNavigation(targetUrl: string, entryUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const entry = new URL(entryUrl)
    if (entry.protocol === 'file:') {
      return target.protocol === 'file:' && target.host === entry.host && target.pathname === entry.pathname
    }
    return target.origin === entry.origin
  } catch {
    return false
  }
}
