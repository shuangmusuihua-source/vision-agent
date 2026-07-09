import Store from 'electron-store'
import { safeStorage } from 'electron'
import path from 'path'
import { app } from 'electron'
import type { ModelProfile, WorkspaceRecord, SessionRecord } from '../../shared/types'
import type { CronTask } from '../../shared/cron-types'
import { DOCUMENTS_DIR_NAME } from '../../shared/branding'
import { KNOWLEDGE_BASE_NAME } from '../../shared/workspace-paths'
import { getAppUserDataDir } from '../app-identity'

export function getKnowledgeBaseDir(): string {
  return path.join(app.getPath('documents'), DOCUMENTS_DIR_NAME, KNOWLEDGE_BASE_NAME)
}

export const ENCRYPTION_PREFIX = 'enc:'

export function encryptValue(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) return plaintext
  const encrypted = safeStorage.encryptString(plaintext)
  return ENCRYPTION_PREFIX + encrypted.toString('base64')
}

export function decryptValue(encrypted: string): string {
  if (!encrypted || !encrypted.startsWith(ENCRYPTION_PREFIX)) return encrypted
  if (!safeStorage.isEncryptionAvailable()) return encrypted
  try {
    const buffer = Buffer.from(encrypted.slice(ENCRYPTION_PREFIX.length), 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return encrypted
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '***' + key.slice(-4)
}

export type { CronTask }

export interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  fixedDirectories: string[]
  workspaces: WorkspaceRecord[]
  sessions: SessionRecord[]
  compactionSessionIds: string[]
  storeVersion: number
  theme: 'light' | 'dark' | 'system'
  cronTasks: CronTask[]
  enabledSkills: string[]
  disabledSkills: string[]
}

export const store = new Store<AppSettings>({
  cwd: getAppUserDataDir(),
  defaults: {
    profiles: [],
    activeProfileId: null,
    authorizedDirectories: [],
    fixedDirectories: [],
    workspaces: [],
    sessions: [],
    compactionSessionIds: [],
    storeVersion: 0,
    theme: 'system',
    cronTasks: [],
    enabledSkills: [],
    disabledSkills: [],
  },
})
