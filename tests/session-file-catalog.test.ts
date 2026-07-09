import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const mocks = vi.hoisted(() => ({ sessions: [] as Array<Record<string, unknown>> }))

vi.mock('../src/main/persistence/store-core', () => ({
  getKnowledgeBaseDir: vi.fn(() => '/knowledge'),
  store: {
    get: vi.fn((key: string) => key === 'sessions' ? mocks.sessions : []),
  },
}))

const { ensureSessionWorkingDirectory } = await import('../src/main/session-files')
const { getSessionFileOutputs, isSessionFileMutationTool } = await import('../src/main/session-file-catalog')
const { captureSessionOutputSnapshot, recordSessionOutputProvenance } = await import('../src/main/session-output-metadata')
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
    await writeFile(join(workingDirectory, 'deliverables', 'notes-deck.pdf'), 'pdf')
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

    expect(files.map((file) => file.fileName).sort()).toEqual(['notes-deck.pdf', 'notes.md'])
    expect(files.find((file) => file.fileName === 'notes.md')?.category).toBe('document')
    expect(files.find((file) => file.fileName === 'notes-deck.pdf')?.category).toBe('skill_output')
    expect(files.find((file) => file.fileName === 'notes-deck.pdf')?.provenance?.sourceDocumentName).toBe('notes.md')
    expect(files.some((file) => file.filePath === join(workspace, 'other-session.md'))).toBe(false)
  })

  it('persists Skill and source-document provenance for newly generated artifacts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sumi-session-catalog-'))
    tempDirs.push(workspace)
    const workingDirectory = await ensureSessionWorkingDirectory(workspace, 'session-b')
    const sourceDocument = join(workingDirectory, 'research.md')
    await writeFile(sourceDocument, '# Research')
    const before = await captureSessionOutputSnapshot(workingDirectory)
    const artifact = join(workingDirectory, 'research.html')
    await writeFile(artifact, '<h1>Research</h1>')
    await recordSessionOutputProvenance({
      workingDirectory,
      before,
      skillId: 'frontend-slides',
      sourceDocumentPath: sourceDocument,
    })
    mocks.sessions = [{
      id: 'session-b',
      workspacePath: workspace,
      workingDirectory,
      context: 'editor',
    }]

    const files = await getSessionFileOutputs('session-b')
    const output = files.find((file) => file.filePath === artifact)

    expect(output?.provenance).toEqual({
      skillId: 'frontend-slides',
      sourceDocumentPath: sourceDocument,
      sourceDocumentName: 'research.md',
    })
    expect(output?.modifiedAt).toEqual(expect.any(Number))
    expect(output?.relativePath).toBe('research.html')
  })
})
