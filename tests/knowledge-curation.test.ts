import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { addMarkdownToKnowledge } from '../src/main/knowledge-curation'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('knowledge curation', () => {
  it('copies markdown, preserves provenance, and resolves name conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-'))
    tempDirs.push(root)
    const source = join(root, 'research.md')
    const knowledgeDir = join(root, 'Knowledge')

    await writeFile(source, '# First')
    const first = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-a' })
    expect(first).toMatchObject({ success: true, fileName: 'research.md', alreadyExists: false })

    const duplicate = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-a' })
    expect(duplicate).toMatchObject({ success: true, fileName: 'research.md', alreadyExists: true })

    await writeFile(source, '# Revised')
    const revised = await addMarkdownToKnowledge({ sourcePath: source, knowledgeDir, sessionId: 'session-b' })
    expect(revised).toMatchObject({ success: true, fileName: 'research (2).md', alreadyExists: false })
    await expect(readFile(join(knowledgeDir, 'research (2).md'), 'utf8')).resolves.toBe('# Revised')

    const provenance = JSON.parse(
      await readFile(join(knowledgeDir, '.vision', 'knowledge-provenance.json'), 'utf8')
    )
    expect(provenance['research.md']).toMatchObject({ sourcePath: source, sessionId: 'session-a' })
    expect(provenance['research (2).md']).toMatchObject({ sourcePath: source, sessionId: 'session-b' })
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
