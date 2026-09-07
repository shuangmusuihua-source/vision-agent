import { ipcMain, nativeTheme } from 'electron'
import { basename } from 'path'
import {
  getSettings, addProfile, updateProfile, removeProfile, setActiveProfile, getProfileIds,
} from '../persistence/profile-store'
import { setTheme } from '../persistence/settings-store'
import type { WorkspaceLifecycle } from '../workspace-lifecycle'
import type { ModelUsageRange } from '../../shared/types'
import { getModelUsageDetail, getModelUsageSummaries } from '../persistence/model-usage-store'
import { getSessionRecords } from '../persistence/workspace-store'

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

  ipcMain.handle('settings:getModelUsageSummaries', () => {
    return getModelUsageSummaries(getProfileIds())
  })

  ipcMain.handle('settings:getModelUsageDetail', (_event, request: { profileId: string; range: ModelUsageRange }) => {
    const profileExists = getProfileIds().includes(request.profileId)
    if (!profileExists) throw new Error('模型配置不存在')
    const range: ModelUsageRange = ['7d', '30d', '90d', 'all'].includes(request.range)
      ? request.range
      : '30d'
    const detail = getModelUsageDetail(request.profileId, range)
    // electron-store reads and parses the backing file on every get. Join this
    // request against one snapshot rather than rereading it for every session.
    const sessionsById = new Map(getSessionRecords().map((session) => [session.id, session]))
    return {
      ...detail,
      sessions: detail.sessions.map((session) => {
        if (session.source !== 'interactive') return session
        const current = sessionsById.get(session.sessionId)
        if (!current) return session
        return {
          ...session,
          title: current.title || session.title,
          workspaceName: current.context === 'ask' ? 'Ask sumi' : basename(current.workspacePath),
        }
      }),
    }
  })
}
