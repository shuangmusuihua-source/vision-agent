import { ipcMain, nativeTheme } from 'electron'
import {
  getSettings, addProfile, updateProfile, removeProfile, setActiveProfile,
  addAuthorizedDirectory, removeAuthorizedDirectory, reorderAuthorizedDirectories,
  getAuthorizedDirectories, getTheme, setTheme,
} from '../store'
import { fileIndexService } from '../file-index-service'

export function registerSettingsHandlers(pushSettingsToRenderer: () => void): void {
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

  ipcMain.handle('settings:addDirectory', async (_event, dir: string) => {
    addAuthorizedDirectory(dir)
    await fileIndexService.init(getAuthorizedDirectories())
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:removeDirectory', async (_event, dir: string) => {
    removeAuthorizedDirectory(dir)
    await fileIndexService.init(getAuthorizedDirectories())
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:reorderDirectories', async (_event, paths: string[]) => {
    reorderAuthorizedDirectories(paths)
    await fileIndexService.init(getAuthorizedDirectories())
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:getTheme', () => getTheme())

  ipcMain.handle('settings:setTheme', (_event, theme: 'light' | 'dark' | 'system') => {
    setTheme(theme)
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme
    pushSettingsToRenderer()
    return { success: true }
  })
}
