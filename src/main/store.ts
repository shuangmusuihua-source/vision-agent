import Store from 'electron-store'
import { safeStorage } from 'electron'

const ENCRYPTION_PREFIX = 'enc:'

function encryptValue(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) return plaintext
  const encrypted = safeStorage.encryptString(plaintext)
  return ENCRYPTION_PREFIX + encrypted.toString('base64')
}

function decryptValue(encrypted: string): string {
  if (!encrypted || !encrypted.startsWith(ENCRYPTION_PREFIX)) return encrypted
  if (!safeStorage.isEncryptionAvailable()) return encrypted
  try {
    const buffer = Buffer.from(encrypted.slice(ENCRYPTION_PREFIX.length), 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return encrypted
  }
}

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '***' + key.slice(-4)
}

interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: string
  baseUrl: string
  model: string
}

export interface CronTask {
  id: string
  name: string
  cronExpression: string
  prompt: string
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
  status: 'active' | 'paused'
}

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  theme: 'light' | 'dark' | 'system'
  cronTasks: CronTask[]
}

const store = new Store<AppSettings>({
  defaults: {
    profiles: [],
    activeProfileId: null,
    authorizedDirectories: [],
    theme: 'system',
    cronTasks: []
  }
})

// Migrate plaintext API keys to encrypted on first read
let migrationDone = false
function migrateApiKeys(): void {
  if (migrationDone) return
  migrationDone = true
  const profiles = store.get('profiles')
  const updated = profiles.map((p) => {
    if (p.apiKey && !p.apiKey.startsWith(ENCRYPTION_PREFIX)) {
      return { ...p, apiKey: encryptValue(p.apiKey) }
    }
    return p
  })
  if (updated.some((p, i) => p.apiKey !== profiles[i].apiKey)) {
    store.set('profiles', updated)
  }
}

export function getSettings(): AppSettings {
  migrateApiKeys()
  // Return masked API keys to the renderer — never expose plaintext
  const settings = store.store
  return {
    ...settings,
    profiles: settings.profiles.map((p) => ({
      ...p,
      apiKey: maskApiKey(decryptValue(p.apiKey))
    }))
  }
}

export function getActiveProfile(): ModelProfile | null {
  migrateApiKeys()
  const settings = store.store
  return settings.profiles.find((p) => p.id === settings.activeProfileId) || null
}

export function getApiKey(): string {
  migrateApiKeys()
  const profile = getActiveProfileRaw()
  if (!profile) return ''
  return decryptValue(profile.apiKey)
}

function getActiveProfileRaw(): ModelProfile | null {
  const settings = store.store
  return settings.profiles.find((p) => p.id === settings.activeProfileId) || null
}

export function getBaseUrl(): string {
  migrateApiKeys()
  const profile = getActiveProfileRaw()
  return profile?.baseUrl || ''
}

export function getModel(): string {
  migrateApiKeys()
  const profile = getActiveProfileRaw()
  return profile?.model || 'claude-sonnet-4-20250514'
}

export function getAuthorizedDirectories(): string[] {
  return store.get('authorizedDirectories')
}

export function addProfile(profile: ModelProfile): void {
  const encryptedProfile = {
    ...profile,
    apiKey: encryptValue(profile.apiKey)
  }
  const profiles = store.get('profiles')
  const newProfiles = [...profiles, encryptedProfile]
  const newActiveId = store.get('activeProfileId') || profile.id
  store.set({ profiles: newProfiles, activeProfileId: newActiveId })
}

export function updateProfile(id: string, updates: Partial<ModelProfile>): void {
  const profiles = store.get('profiles')
  const idx = profiles.findIndex((p) => p.id === id)
  if (idx >= 0) {
    const encryptedUpdates = { ...updates }
    if (encryptedUpdates.apiKey) {
      encryptedUpdates.apiKey = encryptValue(encryptedUpdates.apiKey)
    }
    profiles[idx] = { ...profiles[idx], ...encryptedUpdates }
    store.set('profiles', profiles)
  }
}

export function removeProfile(id: string): void {
  const profiles = store.get('profiles')
  const newProfiles = profiles.filter((p) => p.id !== id)
  const currentActiveId = store.get('activeProfileId')
  const newActiveId = currentActiveId === id
    ? (newProfiles.length > 0 ? newProfiles[0].id : null)
    : currentActiveId
  store.set({ profiles: newProfiles, activeProfileId: newActiveId })
}

export function setActiveProfile(id: string): void {
  store.set('activeProfileId', id)
}

export function addAuthorizedDirectory(dir: string): void {
  const dirs = store.get('authorizedDirectories')
  if (!dirs.includes(dir)) {
    store.set('authorizedDirectories', [dir, ...dirs])
  }
}

export function removeAuthorizedDirectory(dir: string): void {
  const dirs = store.get('authorizedDirectories')
  store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
}

export function reorderAuthorizedDirectories(paths: string[]): void {
  const current = store.get('authorizedDirectories')
  if (paths.length !== current.length) return
  if (!paths.every((p) => current.includes(p))) return
  store.set('authorizedDirectories', paths)
}

export function getTheme(): 'light' | 'dark' | 'system' {
  return store.get('theme')
}

export function setTheme(theme: 'light' | 'dark' | 'system'): void {
  store.set('theme', theme)
}

export function getCronTasks(): CronTask[] {
  return store.get('cronTasks') || []
}

export function saveCronTasks(tasks: CronTask[]): void {
  store.set('cronTasks', tasks)
}

export type { ModelProfile, AppSettings }