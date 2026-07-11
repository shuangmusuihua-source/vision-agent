import type { ModelProfile } from '../../shared/types'
import { store, encryptValue, decryptValue, maskApiKey, type AppSettings } from './store-core'
import { filterUserWorkspacePaths } from '../../shared/workspace-paths'

export function getSettings(): AppSettings {
  const settings = store.store
  const authorizedDirectories = filterUserWorkspacePaths(settings.authorizedDirectories, settings.fixedDirectories)
  return {
    ...settings,
    authorizedDirectories,
    profiles: settings.profiles.map((p) => ({
      ...p,
      apiKey: maskApiKey(decryptValue(p.apiKey)),
    })),
  }
}

export function getActiveProfile(): ModelProfile | null {
  const settings = store.store
  return settings.profiles.find((p) => p.id === settings.activeProfileId) || null
}

export function getApiKey(): string {
  const profile = getActiveProfileRaw()
  if (!profile) return ''
  return decryptValue(profile.apiKey)
}

function getActiveProfileRaw(): ModelProfile | null {
  const settings = store.store
  return settings.profiles.find((p) => p.id === settings.activeProfileId) || null
}

export function getBaseUrl(): string {
  const profile = getActiveProfileRaw()
  return profile?.baseUrl || ''
}

export function getModel(): string {
  const profile = getActiveProfileRaw()
  return profile?.model || 'claude-sonnet-4-20250514'
}

export function addProfile(profile: ModelProfile): void {
  const encryptedProfile = { ...profile, apiKey: encryptValue(profile.apiKey) }
  const profiles = store.get('profiles')
  const newProfiles = [...profiles, encryptedProfile]
  const newActiveId = store.get('activeProfileId') || profile.id
  store.set('profiles', newProfiles)
  store.set('activeProfileId', newActiveId)
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
  store.set('profiles', newProfiles)
  store.set('activeProfileId', newActiveId)
}

export function setActiveProfile(id: string): void {
  store.set('activeProfileId', id)
}
