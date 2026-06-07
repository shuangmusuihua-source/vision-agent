import Store from 'electron-store'
import { mkdirSync } from 'fs'
import path from 'path'
import { app } from 'electron'

const KNOWLEDGE_BASE_NAME = 'Knowledge'

export function getKnowledgeBaseDir(): string {
  return path.join(app.getPath('documents'), 'VisionAgent', KNOWLEDGE_BASE_NAME)
}
import { safeStorage } from 'electron'
import type { ModelProfile } from '../shared/types'
import { getBuiltinSkills } from './skills/builtin'

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
  fixedDirectories: string[]
  theme: 'light' | 'dark' | 'system'
  cronTasks: CronTask[]
  enabledSkills: string[]
}

const store = new Store<AppSettings>({
  defaults: {
    profiles: [],
    activeProfileId: null,
    authorizedDirectories: [],
    fixedDirectories: [],
    theme: 'system',
    cronTasks: [],
    enabledSkills: []
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
  const fixed = store.get('fixedDirectories')
  if (fixed.includes(dir)) return
  const dirs = store.get('authorizedDirectories')
  store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
}

export function reorderAuthorizedDirectories(paths: string[]): void {
  const fixed = store.get('fixedDirectories')
  const current = store.get('authorizedDirectories')
  if (paths.length !== current.length) return
  if (!paths.every((p) => current.includes(p))) return
  // Fixed dirs always stay at the front, only non-fixed dirs can be reordered
  const fixedInPaths = fixed.filter(f => paths.includes(f))
  const nonFixed = paths.filter(p => !fixed.includes(p))
  store.set('authorizedDirectories', [...fixedInPaths, ...nonFixed])
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

export function getFixedDirectories(): string[] {
  return store.get('fixedDirectories')
}

export function ensureKnowledgeBase(): string {
  const kbDir = getKnowledgeBaseDir()
  mkdirSync(kbDir, { recursive: true })
  mkdirSync(path.join(kbDir, '.vision'), { recursive: true })

  const fixed = store.get('fixedDirectories')
  if (!fixed.includes(kbDir)) {
    store.set('fixedDirectories', [kbDir, ...fixed])
  }

  const dirs = store.get('authorizedDirectories')
  if (!dirs.includes(kbDir)) {
    store.set('authorizedDirectories', [kbDir, ...dirs])
  } else if (dirs[0] !== kbDir) {
    const reordered = [kbDir, ...dirs.filter((d) => d !== kbDir)]
    store.set('authorizedDirectories', reordered)
  }

  return kbDir
}

export function getEnabledSkills(): string[] {
  const stored = store.get('enabledSkills')
  const builtins = getBuiltinSkills().map((s: { id: string }) => s.id)
  // On first launch, default to all built-in skills
  if (!stored || stored.length === 0) {
    return builtins
  }
  // Merge any newly added built-in skills that aren't in the stored list yet
  const merged = [...stored]
  for (const id of builtins) {
    if (!merged.includes(id)) merged.push(id)
  }
  if (merged.length !== stored.length) {
    store.set('enabledSkills', merged)
  }
  return merged
}

export function setEnabledSkills(skillIds: string[]): void {
  store.set('enabledSkills', skillIds)
}

export function toggleSkill(skillId: string, enabled: boolean): string[] {
  let current = store.get('enabledSkills')
  // On first toggle, seed with all built-in skill IDs as defaults
  if (!current || current.length === 0) {
    current = getBuiltinSkills().map((s: { id: string }) => s.id)
  }
  let next: string[]
  if (enabled) {
    next = current.includes(skillId) ? current : [...current, skillId]
  } else {
    next = current.filter((id) => id !== skillId)
  }
  store.set('enabledSkills', next)
  return next
}

export type { ModelProfile, AppSettings }