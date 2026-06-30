import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileIndexService } from '../src/main/file-index-service'

const tempDirs: string[] = []

async function createWorkspace(fileName: string, content: string): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sumi-file-index-'))
  tempDirs.push(workspacePath)
  await writeFile(join(workspacePath, fileName), content, 'utf-8')
  return workspacePath
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('FileIndexService knowledge graph identity', () => {
  it('resolves duplicate wikilink labels relative to their source directory', async () => {
    const knowledgePath = await mkdtemp(join(tmpdir(), 'sumi-knowledge-index-'))
    tempDirs.push(knowledgePath)
    const firstDir = join(knowledgePath, 'first')
    const secondDir = join(knowledgePath, 'second')
    await mkdir(firstDir)
    await mkdir(secondDir)
    await writeFile(join(firstDir, 'note.md'), '# First note')
    await writeFile(join(secondDir, 'note.md'), '# Second note')
    await writeFile(join(firstDir, 'source.md'), '[[note]]')
    await writeFile(join(knowledgePath, 'ambiguous.md'), '[[note]]')
    const index = new FileIndexService()

    try {
      await index.initKnowledgeIndex(knowledgePath)
      const graph = index.getKnowledgeGraphData()

      expect(graph.edges).toContainEqual({
        source: join(firstDir, 'source.md'),
        target: join(firstDir, 'note.md'),
        type: 'reference',
      })
      expect(graph.edges.some(edge => edge.source === join(knowledgePath, 'ambiguous.md'))).toBe(false)
    } finally {
      await index.destroy()
    }
  })

  it('acknowledges only changes at or before the loaded graph version', async () => {
    const index = new FileIndexService()
    const markChanged = (index as unknown as { markFileChanged: (path: string) => void }).markFileChanged.bind(index)

    markChanged('/knowledge/first.md')
    const loadedVersion = index.getChangeVersion()
    markChanged('/knowledge/newer.md')

    expect(index.acknowledgeChanges(loadedVersion)).toEqual({
      count: 1,
      files: ['/knowledge/newer.md'],
      version: 2,
    })
  })
})

describe('FileIndexService workspace search', () => {
  it('searches markdown content across every configured workspace', async () => {
    const firstWorkspace = await createWorkspace('market.md', 'shared research phrase from market')
    const secondWorkspace = await createWorkspace('persona.md', 'shared research phrase from persona')
    const index = new FileIndexService()

    try {
      await index.init([firstWorkspace, secondWorkspace])

      const results = index.search('shared research phrase')
      expect(results.map((result) => result.filePath).sort()).toEqual([
        join(firstWorkspace, 'market.md'),
        join(secondWorkspace, 'persona.md'),
      ].sort())
    } finally {
      await index.destroy()
    }
  })

  it('removes files from workspaces that are no longer configured', async () => {
    const removedWorkspace = await createWorkspace('old.md', 'legacy workspace content')
    const remainingWorkspace = await createWorkspace('current.md', 'current workspace content')
    const index = new FileIndexService()

    try {
      await index.init([removedWorkspace, remainingWorkspace])
      expect(index.search('legacy workspace content')).toHaveLength(1)

      await index.init([remainingWorkspace])
      expect(index.search('legacy workspace content')).toHaveLength(0)
      expect(index.search('current workspace content')).toHaveLength(1)
    } finally {
      await index.destroy()
    }
  })
})
