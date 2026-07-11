import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptFiles(filePath)
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : []
  })
}

function collectLiteralChannels(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

describe('shared IPC contract coverage', () => {
  const root = process.cwd()
  const mainSource = collectTypeScriptFiles(join(root, 'src/main'))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n')
  const contractSource = readFileSync(join(root, 'src/shared/ipc-types.ts'), 'utf8')
  const preloadSource = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
  const requestSection = contractSource.slice(
    contractSource.indexOf('export type IPCChannelMap'),
    contractSource.indexOf('export type IPCEventMap'),
  )
  const eventSection = contractSource.slice(contractSource.indexOf('export type IPCEventMap'))

  it('covers every literal ipcMain.handle channel', () => {
    const channels = new Set(collectLiteralChannels(
      mainSource,
      /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g,
    ))

    for (const channel of channels) {
      expect(requestSection, `${channel} is missing from IPCChannelMap`).toContain(`'${channel}'`)
    }
  })

  it('implements every request contract in main and preload', () => {
    const contractChannels = new Set(collectLiteralChannels(
      requestSection,
      /^\s*['"]([^'"]+)['"]\s*:\s*\{/gm,
    ))
    const handledChannels = new Set(collectLiteralChannels(
      mainSource,
      /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g,
    ))
    const invokedChannels = new Set(collectLiteralChannels(
      preloadSource,
      /invoke\(\s*['"]([^'"]+)['"]/g,
    ))

    for (const channel of contractChannels) {
      expect(handledChannels, `${channel} has no main handler`).toContain(channel)
      expect(invokedChannels, `${channel} is not exposed by preload`).toContain(channel)
    }
  })

  it('covers every literal BrowserWindow push channel', () => {
    const channels = new Set(collectLiteralChannels(
      mainSource,
      /\.webContents\.send\(\s*['"]([^'"]+)['"]/g,
    ))

    for (const channel of channels) {
      expect(eventSection, `${channel} is missing from IPCEventMap`).toContain(`'${channel}'`)
    }
  })

  it('subscribes preload to every event contract', () => {
    const contractChannels = new Set(collectLiteralChannels(
      eventSection,
      /^\s*['"]([^'"]+)['"]\s*:/gm,
    ))
    const subscribedChannels = new Set(collectLiteralChannels(
      preloadSource,
      /ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g,
    ))

    for (const channel of contractChannels) {
      expect(subscribedChannels, `${channel} is not subscribed by preload`).toContain(channel)
    }
  })
})
