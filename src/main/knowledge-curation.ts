import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { basename, extname, join, parse, resolve } from 'path'
import { atomicWriteTextFile } from './atomic-write'

export interface KnowledgeImportResult {
  success: boolean
  filePath?: string
  fileName?: string
  alreadyExists?: boolean
  updated?: boolean
  error?: string
}

type KnowledgeProvenance = Record<string, {
  sourcePath: string
  sessionId?: string
  addedAt: number
  syncedAt?: number
  sourceHash?: string
}>

export interface KnowledgeSyncState {
  status: 'not_added' | 'synced' | 'update_available'
  filePath?: string
  fileName?: string
  addedAt?: number
  syncedAt?: number
}

const PROVENANCE_RELATIVE_PATH = join('.vision', 'knowledge-provenance.json')

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function readProvenance(filePath: string): Promise<KnowledgeProvenance> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as KnowledgeProvenance
  } catch {
    return {}
  }
}

export async function getKnowledgeSyncStates(
  sourcePaths: string[],
  knowledgeDir: string,
): Promise<Map<string, KnowledgeSyncState>> {
  const states = new Map<string, KnowledgeSyncState>()
  const provenance = await readProvenance(join(knowledgeDir, PROVENANCE_RELATIVE_PATH))
  const entries = Object.entries(provenance)

  await Promise.all(sourcePaths.map(async (sourcePath) => {
    const resolvedSource = resolve(sourcePath)
    const match = entries
      .filter(([, item]) => resolve(item.sourcePath) === resolvedSource)
      .sort(([, a], [, b]) => (b.syncedAt || b.addedAt) - (a.syncedAt || a.addedAt))[0]
    if (!match) {
      states.set(sourcePath, { status: 'not_added' })
      return
    }

    const [fileName, item] = match
    const destination = join(knowledgeDir, fileName)
    try {
      const [sourceContent, destinationContent] = await Promise.all([
        readFile(sourcePath, 'utf8'),
        readFile(destination, 'utf8'),
      ])
      const currentHash = contentHash(sourceContent)
      const syncedHash = item.sourceHash || contentHash(destinationContent)
      states.set(sourcePath, {
        status: currentHash === syncedHash ? 'synced' : 'update_available',
        filePath: destination,
        fileName,
        addedAt: item.addedAt,
        syncedAt: item.syncedAt || item.addedAt,
      })
    } catch {
      states.set(sourcePath, { status: 'not_added' })
    }
  }))

  return states
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
    const metadataDir = join(options.knowledgeDir, '.vision')
    const provenancePath = join(options.knowledgeDir, PROVENANCE_RELATIVE_PATH)
    await mkdir(metadataDir, { recursive: true })
    const provenance = await readProvenance(provenancePath)
    const resolvedSource = resolve(options.sourcePath)
    const existingSourceEntry = Object.entries(provenance)
      .filter(([, item]) => resolve(item.sourcePath) === resolvedSource)
      .sort(([, a], [, b]) => (b.syncedAt || b.addedAt) - (a.syncedAt || a.addedAt))[0]

    let destination = existingSourceEntry
      ? join(options.knowledgeDir, existingSourceEntry[0])
      : join(options.knowledgeDir, sourceName)
    let suffix = 2

    if (!existingSourceEntry) while (existsSync(destination)) {
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

    const destinationExisted = existsSync(destination)
    const destinationContent = destinationExisted ? await readFile(destination, 'utf8').catch(() => null) : null
    const now = Date.now()
    await atomicWriteTextFile(destination, content)
    const previous = provenance[basename(destination)]
    provenance[basename(destination)] = {
      sourcePath: resolvedSource,
      sessionId: options.sessionId,
      addedAt: previous?.addedAt || now,
      syncedAt: now,
      sourceHash: contentHash(content),
    }
    await atomicWriteTextFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)

    return {
      success: true,
      filePath: destination,
      fileName: basename(destination),
      alreadyExists: destinationContent === content,
      updated: destinationExisted && destinationContent !== content,
    }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
