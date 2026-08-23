import { ipcMain } from 'electron'
import { getFeishuConnectorManager } from '../feishu-connection'
import { getEnabledSkills, toggleSkill } from '../persistence/settings-store'
import { getMainWindow } from '../ipc-sender'
import type {
  FeishuAuthChallenge,
  FeishuCapabilityId,
  FeishuConnectorStatus,
} from '../../shared/feishu-types'

export function registerFeishuHandlers(): void {
  const connector = getFeishuConnectorManager()

  connector.on('status-changed', (status: FeishuConnectorStatus) => {
    const window = getMainWindow()
    if ((status.phase === 'connected' || status.phase === 'bot-only') && !getEnabledSkills().includes('feishu')) {
      toggleSkill('feishu', true)
      if (window && !window.isDestroyed()) {
        window.webContents.send('skills:changed', { skillId: 'feishu', reason: 'toggled' })
      }
    }
    if (window && !window.isDestroyed()) {
      window.webContents.send('feishu:statusChanged', status)
    }
  })

  connector.on('auth-challenge', (challenge: FeishuAuthChallenge) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('feishu:authChallenge', challenge)
    }
  })

  ipcMain.handle('feishu:status', () => connector.getStatus())
  ipcMain.handle('feishu:installRuntime', () => connector.installRuntime())
  ipcMain.handle('feishu:startConfigure', () => connector.startConfigure())
  ipcMain.handle('feishu:startLogin', () => connector.startLogin())
  ipcMain.handle(
    'feishu:grantCapability',
    (_event, capabilityId: FeishuCapabilityId) => connector.grantCapability(capabilityId),
  )
  ipcMain.handle('feishu:cancelOperation', () => connector.cancelOperation())
  ipcMain.handle('feishu:logout', () => connector.logout())
}
