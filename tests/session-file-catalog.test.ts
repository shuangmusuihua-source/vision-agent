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
const {
  captureSessionOutputSnapshot,
  readSessionOutputMetadata,
  reconcileSessionOutputMetadata,
  recordSessionOutputProvenance,
  scanSessionOutputs,
} = await import('../src/main/session-output-metadata')
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

  it('collects catalog fields and the metadata snapshot in one scan', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sumi-session-catalog-'))
    tempDirs.push(workingDirectory)
    await mkdir(join(workingDirectory, 'nested'), { recursive: true })
    await writeFile(join(workingDirectory, 'nested', 'report.md'), '# Report')
    await mkdir(join(workingDirectory, '.sumi'), { recursive: true })
    await writeFile(join(workingDirectory, '.sumi', 'private.md'), '# Private')

    const scan = await scanSessionOutputs(workingDirectory)

    expect(scan.files).toHaveLength(1)
    expect(scan.files[0]).toMatchObject({
      fileName: 'report.md',
      relativePath: join('nested', 'report.md'),
      size: 8,
    })
    expect(scan.snapshot[join('nested', 'report.md')]).toMatchObject({ size: 8 })
    expect(scan.snapshot[join('.sumi', 'private.md')]).toBeUndefined()
  })

  it('serializes metadata reconciliation with Skill provenance updates', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'sumi-session-catalog-'))
    tempDirs.push(workingDirectory)
    const sourceDocument = join(workingDirectory, 'brief.md')
    await writeFile(sourceDocument, '# Brief')
    const before = await captureSessionOutputSnapshot(workingDirectory)
    await writeFile(join(workingDirectory, 'brief.pptx'), 'deck')
    const after = await captureSessionOutputSnapshot(workingDirectory)

    await Promise.all([
      recordSessionOutputProvenance({
        workingDirectory,
        before,
        skillId: 'slides',
        sourceDocumentPath: sourceDocument,
      }),
      reconcileSessionOutputMetadata(workingDirectory, after),
      reconcileSessionOutputMetadata(workingDirectory, after),
    ])

    const metadata = await readSessionOutputMetadata(workingDirectory)
    expect(metadata.files['brief.pptx']).toMatchObject({
      skillId: 'slides',
      sourceDocumentPath: sourceDocument,
    })
  })
})
