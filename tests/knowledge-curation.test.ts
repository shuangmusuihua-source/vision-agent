import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { addMarkdownToKnowledge, getKnowledgeSyncStates } from '../src/main/knowledge-curation'
import { atomicWriteTextFile } from '../src/main/atomic-write'

const hooks = vi.hoisted(() => ({ beforeCompare: undefined as undefined | ((path: string) => Promise<void>) }))
vi.mock('../src/main/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/atomic-write')>()
  return { ...actual, atomicCompareWriteTextFile: async (...args: Parameters<typeof actual.atomicCompareWriteTextFile>) => {
    await hooks.beforeCompare?.(args[0])
    return actual.atomicCompareWriteTextFile(...args)
  } }
})

const tempDirs: string[] = []

afterEach(async () => {
  hooks.beforeCompare = undefined
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('knowledge curation', () => {
  it.each([false, true])('preserves knowledge edits when the source has changed: %s', async (sourceChanged) => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-conflict-'))
    tempDirs.push(root)
    const sourcePath = join(root, 'report.md')
    const knowledgeDir = join(root, 'Knowledge')
    await writeFile(sourcePath, '# Original')
    const first = await addMarkdownToKnowledge({ sourcePath, knowledgeDir })
    const provenancePath = join(knowledgeDir, '.sumi', 'knowledge-provenance.json')
    const originalProvenance = await readFile(provenancePath, 'utf8')
    await writeFile(first.filePath!, '# Original\nMy annotations')
    if (sourceChanged) await writeFile(sourcePath, '# Revised')

    expect((await getKnowledgeSyncStates([sourcePath], knowledgeDir)).get(sourcePath)?.status).toBe('update_available')
    const result = await addMarkdownToKnowledge({ sourcePath, knowledgeDir })
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('已被修改') })
    await expect(readFile(first.filePath!, 'utf8')).resolves.toBe('# Original\nMy annotations')
    await expect(readFile(provenancePath, 'utf8')).resolves.toBe(originalProvenance)

    await writeFile(sourcePath, '# Original\nMy annotations')
    await expect(addMarkdownToKnowledge({ sourcePath, knowledgeDir })).resolves.toMatchObject({ success: true, alreadyExists: true })
  })

  it('refuses to overwrite a legacy entry with no known synchronization hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-legacy-'))
    tempDirs.push(root)
    const sourcePath = join(root, 'report.md')
    const knowledgeDir = join(root, 'Knowledge')
    await mkdir(join(knowledgeDir, '.sumi'), { recursive: true })
    await writeFile(sourcePath, '# New source')
    await writeFile(join(knowledgeDir, 'report.md'), '# Older knowledge with annotations')
    await writeFile(join(knowledgeDir, '.sumi', 'knowledge-provenance.json'), JSON.stringify({
      'report.md': { sourcePath, addedAt: 1 },
    }))
    await expect(addMarkdownToKnowledge({ sourcePath, knowledgeDir })).resolves.toMatchObject({ success: false })
    await expect(readFile(join(knowledgeDir, 'report.md'), 'utf8')).resolves.toBe('# Older knowledge with annotations')
  })

  it('preserves an editor save queued after the synchronization check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-race-'))
    tempDirs.push(root)
    const sourcePath = join(root, 'report.md')
    const knowledgeDir = join(root, 'Knowledge')
    await writeFile(sourcePath, '# Original')
    const first = await addMarkdownToKnowledge({ sourcePath, knowledgeDir })
    await writeFile(sourcePath, '# Revised')
    hooks.beforeCompare = async (path) => { await atomicWriteTextFile(path, '# Concurrent editor save') }

    await expect(addMarkdownToKnowledge({ sourcePath, knowledgeDir })).resolves.toMatchObject({ success: false })
    await expect(readFile(first.filePath!, 'utf8')).resolves.toBe('# Concurrent editor save')
  })

  it('copies markdown, preserves provenance, and updates the same knowledge entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const source = join(root, 'research.md')
    const knowledgeDir = join(root, 'Knowledge')

    await writeFile(source, '# First')
    const first = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-a' })
    expect(first).toMatchObject({ success: true, fileName: 'research.md', alreadyExists: false })

    const synced = await getKnowledgeSyncStates([source], knowledgeDir)
    expect(synced.get(source)?.status).toBe('synced')

    const duplicate = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-a' })
    expect(duplicate).toMatchObject({ success: true, fileName: 'research.md', alreadyExists: true })

    await writeFile(source, '# Revised')
    const changed = await getKnowledgeSyncStates([source], knowledgeDir)
    expect(changed.get(source)?.status).toBe('update_available')

    const revised = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-b' })
    expect(revised).toMatchObject({ success: true, fileName: 'research.md', alreadyExists: false, updated: true })
    await expect(readFile(join(knowledgeDir, 'research.md'), 'utf8')).resolves.toBe('# Revised')

    const provenance = JSON.parse(
      await readFile(join(knowledgeDir, '.sumi', 'knowledge-provenance.json'), 'utf8')
    )
    expect(provenance['research.md']).toMatchObject({ sourcePath: source, sessionId: 'session-b' })
    expect(provenance['research.md'].sourceHash).toEqual(expect.any(String))
  })

  it('keeps same-named documents from different sources as separate entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const firstDir = join(root, 'first')
    const secondDir = join(root, 'second')
    await Promise.all([mkdir(firstDir), mkdir(secondDir)])
    const first = join(firstDir, 'research.md')
    const second = join(secondDir, 'research.md')
    const knowledgeDir = join(root, 'Knowledge')
    await writeFile(first, '# First source')
    await writeFile(second, '# Second source')

    await addMarkdownToKnowledge({ sourcePath: first, knowledgeDir })
    const result = await addMarkdownToKnowledge({ sourcePath: second, knowledgeDir })

    expect(result).toMatchObject({ success: true, fileName: 'research (2).md' })
  })

  it('rejects non-markdown files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const source = join(root, 'report.pdf')
    await writeFile(source, 'pdf')

    await expect(addMarkdownToKnowledge({ sourcePath: source, knowledgeDir: join(root, 'Knowledge') }))
      .resolves.toMatchObject({ success: false })
  })

  it.each(['research.md', 'other.md'])('preserves both contents and provenance during concurrent imports with second name %s', async (secondName) => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    await Promise.all([mkdir(join(root, 'first')), mkdir(join(root, 'second'))])
    const first = join(root, 'first', 'research.md')
    const second = join(root, 'second', secondName)
    const knowledgeDir = join(root, 'Knowledge')
    await Promise.all([writeFile(first, '# First source'), writeFile(second, '# Second source')])

    const results = await Promise.all([
      addMarkdownToKnowledge({ sourcePath: first, knowledgeDir, sessionId: 'session-a' }),
      addMarkdownToKnowledge({ sourcePath: second, knowledgeDir: `${knowledgeDir}/../Knowledge`, sessionId: 'session-b' }),
    ])
    expect(results.every((result) => result.success)).toBe(true)
    expect(new Set(results.map((result) => result.filePath)).size).toBe(2)
    await expect(readFile(results[0].filePath!, 'utf8')).resolves.toBe('# First source')
    await expect(readFile(results[1].filePath!, 'utf8')).resolves.toBe('# Second source')

    const provenance = JSON.parse(await readFile(join(knowledgeDir, '.sumi', 'knowledge-provenance.json'), 'utf8'))
    expect(Object.keys(provenance)).toHaveLength(2)
    expect(provenance[results[0].fileName!]).toMatchObject({ sourcePath: first, sessionId: 'session-a' })
    expect(provenance[results[1].fileName!]).toMatchObject({ sourcePath: second, sessionId: 'session-b' })
    const states = await getKnowledgeSyncStates([first, second], knowledgeDir)
    expect([...states.values()].every((state) => state.status === 'synced')).toBe(true)

    await writeFile(first, '# First revised')
    const updated = await addMarkdownToKnowledge({ sourcePath: first, knowledgeDir })
    expect(updated).toMatchObject({ success: true, filePath: results[0].filePath, updated: true })
    await expect(readFile(results[1].filePath!, 'utf8')).resolves.toBe('# Second source')
  })

  it('imports a burst of files without losing earlier provenance entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const knowledgeDir = join(root, 'Knowledge')
    const sources = Array.from({ length: 20 }, (_, i) => join(root, `source-${i}.md`))
    await Promise.all(sources.map((source, i) => writeFile(source, `# Source ${i}`)))

    const results = await Promise.all(sources.map((sourcePath) => addMarkdownToKnowledge({ sourcePath, knowledgeDir })))
    expect(results.every((result) => result.success)).toBe(true)
    const states = await getKnowledgeSyncStates(sources, knowledgeDir)
    expect(states.size).toBe(20)
    expect([...states.values()].every((state) => state.status === 'synced')).toBe(true)
  })

  it('continues the queue after a failed import and reuses the same entry for repeated sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const knowledgeDir = join(root, 'Knowledge')
    const sourcePath = join(root, 'source.md')
    await writeFile(sourcePath, '# Source')

    const [failed, first, repeated] = await Promise.all([
      addMarkdownToKnowledge({ sourcePath: join(root, 'missing.md'), knowledgeDir }),
      addMarkdownToKnowledge({ sourcePath, knowledgeDir }),
      addMarkdownToKnowledge({ sourcePath, knowledgeDir }),
    ])
    expect(failed.success).toBe(false)
    expect(first).toMatchObject({ success: true, alreadyExists: false })
    expect(repeated).toMatchObject({ success: true, filePath: first.filePath, alreadyExists: true })
    expect((await readdir(knowledgeDir)).filter((name) => name.endsWith('.md'))).toEqual(['source.md'])
  })
})
