import { create } from 'zustand'
import type { AppSettings } from '../lib/ipc'

// ─── Settings Store ──────────────────────────────────────────────────

export type SettingsStore = {
  settings: AppSettings | null
  loaded: boolean

  // Actions
  init: () => Promise<void>
  update: (settings: AppSettings) => void
}

// ─── Store implementation ────────────────────────────────────────────

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loaded: false,

  init: async () => {
    const settings = await window.api.settings.get()
    set({ settings, loaded: true })
  },

  update: (settings) => {
    set({ settings, loaded: true })
  },
}))

// ─── Selectors ───────────────────────────────────────────────────────

export const useSettings = () => useSettingsStore((s) => s.settings)
