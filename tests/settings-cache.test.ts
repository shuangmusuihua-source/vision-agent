import { afterEach, describe, expect, it } from 'vitest'
import type { AppSettingsSnapshot } from '../src/shared/ipc-types'
import { useSettingsStore } from '../src/renderer/store/settings-cache'

const initialSettings: AppSettingsSnapshot = {
  profiles: [],
  activeProfileId: null,
  authorizedDirectories: ['/work/existing'],
  fixedDirectories: ['/work/Knowledge'],
  theme: 'dark',
}

afterEach(() => {
  useSettingsStore.setState({ settings: null, loaded: false })
})

describe('settings workspace projection', () => {
  it('projects one canonical workspace result without replacing unrelated settings', () => {
    useSettingsStore.setState({ settings: initialSettings, loaded: true })

    useSettingsStore.getState().projectWorkspacePaths([
      '/work/research',
      '/work/research/',
      '/work/Knowledge',
    ])

    expect(useSettingsStore.getState()).toMatchObject({
      loaded: true,
      settings: {
        profiles: [],
        activeProfileId: null,
        authorizedDirectories: ['/work/research'],
        fixedDirectories: ['/work/Knowledge'],
        theme: 'dark',
      },
    })
  })

  it('does not synthesize settings before the initial snapshot is loaded', () => {
    useSettingsStore.getState().projectWorkspacePaths(['/work/research'])

    expect(useSettingsStore.getState().settings).toBeNull()
  })
})
