import { ipcMain } from 'electron'
import { getDingTalkConnectorManager } from '../dingtalk-connection'
import { getEnabledSkills, toggleSkill } from '../persistence/settings-store'
import { getMainWindow } from '../ipc-sender'
import type { DingTalkConnectorStatus } from '../../shared/dingtalk-types'

export function registerDingTalkHandlers(): void {
  const connector = getDingTalkConnectorManager()
  connector.on('status-changed', (status: DingTalkConnectorStatus) => {
    const window = getMainWindow()
    if (status.phase === 'connected' && !getEnabledSkills().includes('dingtalk')) {
      toggleSkill('dingtalk', true)
      if (window && !window.isDestroyed()) window.webContents.send('skills:changed', { skillId: 'dingtalk', reason: 'toggled' })
    }
    if (window && !window.isDestroyed()) window.webContents.send('dingtalk:statusChanged', status)
  })
  ipcMain.handle('dingtalk:prepareAuthorization', (_event, product: string) => connector.prepareAuthorization(product))
  ipcMain.handle('dingtalk:grantAuthorization', (_event, planId: string) => connector.grantAuthorization(planId))
  ipcMain.handle('dingtalk:status', () => connector.getStatus())
  ipcMain.handle('dingtalk:installRuntime', () => connector.installRuntime())
  ipcMain.handle('dingtalk:startLogin', () => connector.startLogin())
  ipcMain.handle('dingtalk:reopenAuthorization', () => connector.reopenAuthorization())
  ipcMain.handle('dingtalk:cancelOperation', () => connector.cancelOperation())
  ipcMain.handle('dingtalk:logout', () => connector.logout())
}
