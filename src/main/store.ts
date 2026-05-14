import Store from 'electron-store'

interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
  baseUrl: string
  model: string
}

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
}

const store = new Store<AppSettings>({
  defaults: {
    profiles: [],
    activeProfileId: null,
    authorizedDirectories: []
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
  store.set('profiles', [...profiles, profile])
  if (!store.get('activeProfileId')) {
    store.set('activeProfileId', profile.id)
  }
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
  store.set('profiles', profiles.filter((p) => p.id !== id))
  if (store.get('activeProfileId') === id) {
    store.set('activeProfileId', profiles.length > 0 ? profiles[0].id : null)
  }
}

export function setActiveProfile(id: string): void {
  store.set('activeProfileId', id)
}

export function addAuthorizedDirectory(dir: string): void {
  const dirs = store.get('authorizedDirectories')
  if (!dirs.includes(dir)) {
    store.set('authorizedDirectories', [...dirs, dir])
  }
}

export function removeAuthorizedDirectory(dir: string): void {
  const dirs = store.get('authorizedDirectories')
  store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
}

export type { ModelProfile, AppSettings }