import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { APP_NAME } from '../shared/branding'

const LEGACY_USER_DATA_DIRS = ['Vision Agent', 'vision-agent']

function hasLegacyAppData(dir: string): boolean {
  return existsSync(join(dir, 'config.json')) ||
    existsSync(join(dir, 'zhurong.sqlite3')) ||
    existsSync(join(dir, '.claude'))
}

export function configureAppIdentity(): void {
  app.setName(APP_NAME)
  app.setPath('userData', getAppUserDataDir())
}

export function getAppUserDataDir(): string {
  const appDataDir = app.getPath('appData')
  const currentUserDataDir = join(appDataDir, APP_NAME)
  const legacyUserDataDir = LEGACY_USER_DATA_DIRS
    .map((name) => join(appDataDir, name))
    .find(hasLegacyAppData)

  return legacyUserDataDir || currentUserDataDir
}
