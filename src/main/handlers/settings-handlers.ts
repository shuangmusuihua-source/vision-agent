import { ipcMain, nativeTheme } from 'electron'
import {
  getSettings, addProfile, updateProfile, removeProfile, setActiveProfile,
} from '../persistence/profile-store'
import { setTheme } from '../persistence/settings-store'
import type { WorkspaceLifecycle } from '../workspace-lifecycle'

export function registerSettingsHandlers(
  pushSettingsToRenderer: () => void,
  workspaceLifecycle: WorkspaceLifecycle,
): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:addProfile', (_event, profile: Record<string, unknown>) => {
    addProfile(profile as { id: string; name: string; apiKey: string; apiProvider: string; baseUrl: string; model: string })
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:updateProfile', (_event, id: string, updates: Record<string, unknown>) => {
    const safeUpdates = { ...updates }
    if (typeof safeUpdates.apiKey === 'string' && safeUpdates.apiKey.includes('***')) {
      delete safeUpdates.apiKey
    }
    updateProfile(id, safeUpdates)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:removeProfile', (_event, id: string) => {
    removeProfile(id)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:setActiveProfile', (_event, id: string) => {
    setActiveProfile(id)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:reorderDirectories', async (_event, paths: string[]) => {
    return await workspaceLifecycle.reorder(paths)
  })

  ipcMain.handle('settings:setTheme', (_event, theme: 'light' | 'dark' | 'system') => {
    setTheme(theme)
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme
    pushSettingsToRenderer()
    return { success: true }
  })
}
