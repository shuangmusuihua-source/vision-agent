import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileIndexService, shouldIgnoreIndexPath } from '../src/main/file-index-service'

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

      expect(graph.edges.some((edge) => new Set([edge.source, edge.target]).size === 2
        && [edge.source, edge.target].includes(join(firstDir, 'source.md'))
        && [edge.source, edge.target].includes(join(firstDir, 'note.md')))).toBe(true)
      expect(graph.edges.some(edge => edge.source === join(knowledgePath, 'ambiguous.md'))).toBe(false)
    } finally {
      await index.destroy()
    }
  })

  it('collapses reciprocal and repeated wikilinks into one undirected relationship', async () => {
    const knowledgePath = await mkdtemp(join(tmpdir(), 'sumi-knowledge-index-'))
    tempDirs.push(knowledgePath)
    const alphaPath = join(knowledgePath, 'alpha.md')
    const betaPath = join(knowledgePath, 'beta.md')
    await writeFile(alphaPath, '[[beta]]\n[[beta|Beta alias]]')
    await writeFile(betaPath, '[[alpha]]')
    const index = new FileIndexService()

    try {
      await index.initKnowledgeIndex(knowledgePath)
      const graph = index.getKnowledgeGraphData()

      expect(graph.edges).toEqual([{
        source: alphaPath,
        target: betaPath,
        type: 'reference',
      }])
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
  it('ignores only exact excluded path segments', () => {
    expect(shouldIgnoreIndexPath('/workspace/.sumi/sessions/output.md')).toBe(true)
    expect(shouldIgnoreIndexPath('/workspace/out/output.md')).toBe(true)
    expect(shouldIgnoreIndexPath('C:\\workspace\\dist\\output.md')).toBe(true)
    expect(shouldIgnoreIndexPath('/workspace/about.md')).toBe(false)
    expect(shouldIgnoreIndexPath('/workspace/outline.md')).toBe(false)
    expect(shouldIgnoreIndexPath('/workspace/distant.md')).toBe(false)
  })

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

  it('lists wikilink candidates from the existing index and ignores dependency output', async () => {
    const workspace = await createWorkspace('root.md', '# Root')
    await writeFile(join(workspace, 'about.md'), '# About')
    await writeFile(join(workspace, 'outline.md'), '# Outline')
    await writeFile(join(workspace, 'distant.md'), '# Distant')
    await mkdir(join(workspace, 'notes'))
    await writeFile(join(workspace, 'notes', 'nested.md'), '# Nested')
    await mkdir(join(workspace, 'node_modules'))
    await writeFile(join(workspace, 'node_modules', 'dependency.md'), '# Dependency')
    await mkdir(join(workspace, 'out'))
    await writeFile(join(workspace, 'out', 'generated.md'), '# Generated')
    await mkdir(join(workspace, '.sumi'))
    await writeFile(join(workspace, '.sumi', 'internal.md'), '# Internal')
    const index = new FileIndexService()

    try {
      await index.init([workspace])
      const files = await index.listMarkdownFilesUnder(workspace)
      expect(files).toEqual([
        { label: 'root', path: join(workspace, 'root.md') },
        { label: 'about', path: join(workspace, 'about.md') },
        { label: 'outline', path: join(workspace, 'outline.md') },
        { label: 'distant', path: join(workspace, 'distant.md') },
        { label: 'nested', path: join(workspace, 'notes', 'nested.md') },
      ].sort((left, right) => left.path.localeCompare(right.path)))
    } finally {
      await index.destroy()
    }
  })

  it('serializes concurrent workspace initialization and exposes only the latest index', async () => {
    const firstWorkspace = await createWorkspace('first.md', 'first')
    const secondWorkspace = await createWorkspace('second.md', 'second')
    const index = new FileIndexService()

    try {
      const firstInit = index.init([firstWorkspace])
      const secondInit = index.init([secondWorkspace])
      await Promise.all([firstInit, secondInit, index.onReady()])

      expect(index.listFiles()).toEqual([join(secondWorkspace, 'second.md')])
    } finally {
      await index.destroy()
    }
  })
})
