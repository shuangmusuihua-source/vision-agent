import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { addMarkdownToKnowledge, getKnowledgeSyncStates } from '../src/main/knowledge-curation'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('knowledge curation', () => {
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
      await readFile(join(knowledgeDir, '.vision', 'knowledge-provenance.json'), 'utf8')
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
})
