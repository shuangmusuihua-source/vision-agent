import { create } from 'zustand'
import type { AppSettingsSnapshot } from '../../shared/ipc-types'
import { filterUserWorkspacePaths } from '../../shared/workspace-paths'

// ─── Settings Store ──────────────────────────────────────────────────

export type SettingsStore = {
  settings: AppSettingsSnapshot | null
  loaded: boolean

  // Actions
  init: () => Promise<void>
  update: (settings: AppSettingsSnapshot) => void
  projectWorkspacePaths: (workspacePaths: string[]) => void
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

  projectWorkspacePaths: (workspacePaths) => {
    set((state) => {
      if (!state.settings) return state
      return {
        settings: {
          ...state.settings,
          authorizedDirectories: filterUserWorkspacePaths(
            workspacePaths,
            state.settings.fixedDirectories,
          ),
        },
      }
    })
  },
}))

// ─── Selectors ───────────────────────────────────────────────────────

export const useSettings = () => useSettingsStore((s) => s.settings)
