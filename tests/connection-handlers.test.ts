import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) } }))
vi.mock('../src/main/persistence/profile-store', () => ({
  getApiKey: () => 'active-key', getBaseUrl: () => 'https://example.invalid',
  getProfileApiKey: (id: string) => id === 'inactive-profile' ? 'inactive-key' : '',
}))
import { registerConnectionHandlers } from '../src/main/handlers/connection-handlers'
afterEach(() => vi.unstubAllGlobals())
it.each(['', 'sk-a***1234'])('resolves saved credentials by profile ID for display value %s', async (apiKey) => {
  const fetch = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetch)
  registerConnectionHandlers()
  const response = await mocks.handlers.get('settings:testConnection')!(null, {
    baseUrl: 'https://example.invalid', model: 'test', apiKey, profileId: 'inactive-profile',
  })
  expect(response.success).toBe(true)
  expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('inactive-key')
})
it('tests a newly entered credential and refuses an unavailable saved profile', async () => {
  const fetch = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetch)
  registerConnectionHandlers()
  const handler = mocks.handlers.get('settings:testConnection')!
  await handler(null, { baseUrl: 'https://example.invalid', model: 'test', apiKey: 'replacement', profileId: 'inactive-profile' })
  expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('replacement')
  fetch.mockClear()
  expect((await handler(null, { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', profileId: 'deleted' })).success).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
