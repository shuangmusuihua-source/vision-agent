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

  it('covers every literal BrowserWindow push channel', () => {
    const channels = new Set(collectLiteralChannels(
      mainSource,
      /\.webContents\.send\(\s*['"]([^'"]+)['"]/g,
    ))

    for (const channel of channels) {
      expect(eventSection, `${channel} is missing from IPCEventMap`).toContain(`'${channel}'`)
    }
  })
})
