import React from 'react'
import type { AppSettings } from '../lib/ipc'

type Listener = (settings: AppSettings) => void

let cached: AppSettings | null = null
const listeners = new Set<Listener>()

function notifyAll(): void {
  if (!cached) return
  for (const fn of listeners) fn(cached)
}

export function getSettingsCache(): AppSettings | null {
  return cached
}

export async function initSettingsCache(): Promise<AppSettings> {
  cached = await window.api.settings.get()
  notifyAll()
  return cached
}

export function updateSettingsCache(settings: AppSettings): void {
  cached = settings
  notifyAll()
}

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useSettings(): AppSettings | null {
  const [settings, setSettings] = React.useState<AppSettings | null>(cached)

  React.useEffect(() => {
    if (cached) setSettings(cached)
    return onSettingsChange(setSettings)
  }, [])

  return settings
}
