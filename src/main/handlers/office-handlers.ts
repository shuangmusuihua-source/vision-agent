import { ipcMain } from 'electron'
import { getOfficeCliRuntimeManager } from '../officecli-runtime'

export function registerOfficeHandlers(): void {
  ipcMain.handle('office:runtimeStatus', async () => {
    return getOfficeCliRuntimeManager().getStatus()
  })

  ipcMain.handle('office:installRuntime', async () => {
    return getOfficeCliRuntimeManager().install()
  })
}
