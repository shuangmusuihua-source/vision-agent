import Store from 'electron-store'

interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: string
  baseUrl: string
  model: string
}

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  theme: 'light' | 'dark' | 'system'
}

const store = new Store<AppSettings>({
  defaults: {
    profiles: [],
    activeProfileId: null,
    authorizedDirectories: [],
    theme: 'system'
  }
})

export function getSettings(): AppSettings {
  return store.store
}

export function getActiveProfile(): ModelProfile | null {
  const settings = store.store
  return settings.profiles.find((p) => p.id === settings.activeProfileId) || null
}

export function getApiKey(): string {
  const profile = getActiveProfile()
  return profile?.apiKey || ''
}

export function getBaseUrl(): string {
  const profile = getActiveProfile()
  return profile?.baseUrl || ''
}

export function getModel(): string {
  const profile = getActiveProfile()
  return profile?.model || 'claude-sonnet-4-20250514'
}

export function getAuthorizedDirectories(): string[] {
  return store.get('authorizedDirectories')
}

export function addProfile(profile: ModelProfile): void {
  const profiles = store.get('profiles')
  const newProfiles = [...profiles, profile]
  const newActiveId = store.get('activeProfileId') || profile.id
  store.set({ profiles: newProfiles, activeProfileId: newActiveId })
}

export function updateProfile(id: string, updates: Partial<ModelProfile>): void {
  const profiles = store.get('profiles')
  const idx = profiles.findIndex((p) => p.id === id)
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...updates }
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

export function getTheme(): 'light' | 'dark' | 'system' {
  return store.get('theme')
}

export function setTheme(theme: 'light' | 'dark' | 'system'): void {
  store.set('theme', theme)
}

export type { ModelProfile, AppSettings }