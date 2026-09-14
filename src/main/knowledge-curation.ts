import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { basename, extname, join, parse, resolve } from 'path'
import { atomicCompareWriteTextFile, atomicWriteTextFile } from './atomic-write'

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

const PROVENANCE_RELATIVE_PATH = join('.sumi', 'knowledge-provenance.json')
const importQueues = new Map<string, Promise<void>>()

type KnowledgeImportOptions = {
  sourcePath: string
  knowledgeDir: string
  sessionId?: string
}

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
      const destinationHash = contentHash(destinationContent)
      states.set(sourcePath, {
        status: currentHash === destinationHash ? 'synced' : 'update_available',
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

export async function addMarkdownToKnowledge(options: KnowledgeImportOptions): Promise<KnowledgeImportResult> {
  if (extname(options.sourcePath).toLowerCase() !== '.md') {
    return { success: false, error: '只有 Markdown 文档可以放入知识库' }
  }

  // Naming and provenance belong to one read-modify-write operation. Atomic
  // file writes alone cannot prevent two imports from choosing the same name.
  const knowledgeDir = resolve(options.knowledgeDir)
  const previous = importQueues.get(knowledgeDir) ?? Promise.resolve()
  const run = previous.then(() => importMarkdown({ ...options, knowledgeDir }))
  const settled = run.then(() => {}, () => {})
  importQueues.set(knowledgeDir, settled)
  try {
    return await run
  } finally {
    if (importQueues.get(knowledgeDir) === settled) importQueues.delete(knowledgeDir)
  }
}

async function importMarkdown(options: KnowledgeImportOptions): Promise<KnowledgeImportResult> {
  try {
    const content = await readFile(options.sourcePath, 'utf8')
    await mkdir(options.knowledgeDir, { recursive: true })
    const sourceName = basename(options.sourcePath)
    const parsed = parse(sourceName)
    const metadataDir = join(options.knowledgeDir, '.sumi')
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

    const destinationContent = await readFile(destination, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    const previous = existingSourceEntry?.[1]
    if (previous && destinationContent !== null && destinationContent !== content
      && (!previous.sourceHash || contentHash(destinationContent) !== previous.sourceHash)) {
      throw new Error('知识库文档已被修改，已保留你的内容。请先合并知识库与源文档的修改，再重新同步。')
    }
    const now = Date.now()
    // Editor saves share this queue, so a change made after the check above
    // must also prevent replacement. New destinations must still be absent.
    await atomicCompareWriteTextFile(destination, existingSourceEntry ? destinationContent : null, content)
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
      updated: destinationContent !== null && destinationContent !== content,
    }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
