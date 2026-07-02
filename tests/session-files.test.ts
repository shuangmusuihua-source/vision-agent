import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  ensureAskSessionWorkingDirectory,
  ensureSessionWorkingDirectory,
  getAskSessionWorkingDirectory,
  getSessionWorkingDirectory,
  isManagedSessionWorkingDirectory,
  removeSessionWorkingDirectory,
} from '../src/main/session-files'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('session files', () => {
  it('creates a deterministic isolated directory without exposing the session id', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sumi-session-files-'))
    tempDirs.push(workspace)

    const first = await ensureSessionWorkingDirectory(workspace, '../session-a')
    const second = getSessionWorkingDirectory(workspace, '../session-a')

    expect(first).toBe(second)
    expect(first.startsWith(join(workspace, '.sumi', 'sessions'))).toBe(true)
    expect(first).not.toContain('session-a')
    expect(isManagedSessionWorkingDirectory(workspace, first)).toBe(true)
    await expect(access(first)).resolves.toBeUndefined()
  })

  it('removes only managed session directories', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sumi-session-files-'))
    tempDirs.push(workspace)
    const workingDirectory = await ensureSessionWorkingDirectory(workspace, 'session-a')
    const unrelated = join(workspace, 'shared')
    await mkdir(unrelated)
    await writeFile(join(unrelated, 'keep.md'), 'keep')

    await expect(removeSessionWorkingDirectory(workspace, unrelated)).resolves.toBe(false)
    await expect(removeSessionWorkingDirectory(workspace, workingDirectory)).resolves.toBe(true)
    await expect(access(join(unrelated, 'keep.md'))).resolves.toBeUndefined()
    await expect(access(workingDirectory)).rejects.toThrow()
  })

  it('isolates Ask sessions from the app data root', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'sumi-ask-session-files-'))
    tempDirs.push(appData)

    const workingDirectory = await ensureAskSessionWorkingDirectory(appData, 'ask-session-a')

    expect(workingDirectory).toBe(getAskSessionWorkingDirectory(appData, 'ask-session-a'))
    expect(workingDirectory.startsWith(join(appData, '.sumi', 'ask-sessions'))).toBe(true)
    expect(isManagedSessionWorkingDirectory(appData, workingDirectory, 'ask')).toBe(true)
    expect(isManagedSessionWorkingDirectory(appData, workingDirectory, 'editor')).toBe(false)
    await expect(removeSessionWorkingDirectory(appData, workingDirectory, 'ask')).resolves.toBe(true)
    await expect(access(workingDirectory)).rejects.toThrow()
  })
})
