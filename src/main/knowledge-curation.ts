import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { basename, extname, join, parse } from 'path'
import { atomicWriteTextFile } from './atomic-write'

export interface KnowledgeImportResult {
  success: boolean
  filePath?: string
  fileName?: string
  alreadyExists?: boolean
  error?: string
}

type KnowledgeProvenance = Record<string, {
  sourcePath: string
  sessionId?: string
  addedAt: number
}>

async function readProvenance(filePath: string): Promise<KnowledgeProvenance> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as KnowledgeProvenance
  } catch {
    return {}
  }
}

export async function addMarkdownToKnowledge(options: {
  sourcePath: string
  knowledgeDir: string
  sessionId?: string
}): Promise<KnowledgeImportResult> {
  if (extname(options.sourcePath).toLowerCase() !== '.md') {
    return { success: false, error: '只有 Markdown 文档可以放入知识库' }
  }

  try {
    const content = await readFile(options.sourcePath, 'utf8')
    await mkdir(options.knowledgeDir, { recursive: true })
    const sourceName = basename(options.sourcePath)
    const parsed = parse(sourceName)
    let destination = join(options.knowledgeDir, sourceName)
    let suffix = 2

    while (existsSync(destination)) {
      if (await readFile(destination, 'utf8') === content) {
        return {
          success: true,
          filePath: destination,
          fileName: basename(destination),
          alreadyExists: true,
        }
      }
      destination = join(options.knowledgeDir, `${parsed.name} (${suffix})${parsed.ext}`)
      suffix += 1
    }

    await atomicWriteTextFile(destination, content)
    const metadataDir = join(options.knowledgeDir, '.vision')
    const provenancePath = join(metadataDir, 'knowledge-provenance.json')
    await mkdir(metadataDir, { recursive: true })
    const provenance = await readProvenance(provenancePath)
    provenance[basename(destination)] = {
      sourcePath: options.sourcePath,
      sessionId: options.sessionId,
      addedAt: Date.now(),
    }
    await atomicWriteTextFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)

    return {
      success: true,
      filePath: destination,
      fileName: basename(destination),
      alreadyExists: false,
    }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
