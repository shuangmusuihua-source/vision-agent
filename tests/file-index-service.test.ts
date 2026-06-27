import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
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
