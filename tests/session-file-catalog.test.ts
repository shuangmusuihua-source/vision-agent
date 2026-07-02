import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const mocks = vi.hoisted(() => ({ sessions: [] as Array<Record<string, unknown>> }))

vi.mock('../src/main/persistence/store-core', () => ({
  store: {
    get: vi.fn((key: string) => key === 'sessions' ? mocks.sessions : []),
  },
}))

const { ensureSessionWorkingDirectory } = await import('../src/main/session-files')
const { getSessionFileOutputs, isSessionFileMutationTool } = await import('../src/main/session-file-catalog')
const tempDirs: string[] = []

afterEach(async () => {
  mocks.sessions = []
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('session file catalog', () => {
  it('refreshes only after tools that may mutate session files', () => {
    expect(isSessionFileMutationTool('Write')).toBe(true)
    expect(isSessionFileMutationTool('Bash')).toBe(true)
    expect(isSessionFileMutationTool('Read')).toBe(false)
    expect(isSessionFileMutationTool('WebFetch')).toBe(false)
  })

  it('derives overview files from the owned session directory only', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sumi-session-catalog-'))
    tempDirs.push(workspace)
    const workingDirectory = await ensureSessionWorkingDirectory(workspace, 'session-a')
    await mkdir(join(workingDirectory, 'deliverables'), { recursive: true })
    await mkdir(join(workingDirectory, '.claude', 'skills'), { recursive: true })
    await writeFile(join(workingDirectory, 'notes.md'), '# Notes')
    await writeFile(join(workingDirectory, 'deliverables', 'deck.pdf'), 'pdf')
    await writeFile(join(workingDirectory, '.claude', 'settings.json'), '{}')
    await writeFile(join(workspace, 'other-session.md'), '# External')
    mocks.sessions = [{
      id: 'session-a',
      sdkSessionId: 'sdk-a',
      workspacePath: workspace,
      workingDirectory,
      context: 'editor',
    }]

    const files = await getSessionFileOutputs('sdk-a')

    expect(files.map((file) => file.fileName).sort()).toEqual(['deck.pdf', 'notes.md'])
    expect(files.find((file) => file.fileName === 'notes.md')?.category).toBe('document')
    expect(files.find((file) => file.fileName === 'deck.pdf')?.category).toBe('skill_output')
    expect(files.some((file) => file.filePath === join(workspace, 'other-session.md'))).toBe(false)
  })
})
