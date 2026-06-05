import { ipcMain } from 'electron'
import { getNotificationHistory } from '../notification-manager'

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:getHistory', async () => getNotificationHistory())
}
