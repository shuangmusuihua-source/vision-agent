import { app } from 'electron'
import { join } from 'path'
import { APP_NAME } from '../shared/branding'

export function configureAppIdentity(): void {
  app.setName(APP_NAME)
  app.setPath('userData', getAppUserDataDir())
}

export function getAppUserDataDir(): string {
  return join(app.getPath('appData'), APP_NAME)
}
