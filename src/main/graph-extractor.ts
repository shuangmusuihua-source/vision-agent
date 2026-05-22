import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { query, Query } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'
import { resolveClaudeCodeExecutable } from './agent-manager'

interface SemanticEntity {
  name: string
  type: string
  sourceFile: string
}

interface SemanticRelation {
  from: string
  to: string
  label: string
  sourceFile: string
}

interface SemanticGraphData {
  entities: SemanticEntity[]
  relations: SemanticRelation[]
  fileHashes: Record<string, string>
}

interface GraphNode {
  id: string
  label: string
  type: 'file' | 'memory' | 'entity'
  entityType?: string
}

interface GraphEdge {
  source: string
  target: string
  label?: string
  type: 'reference' | 'semantic'
}

const BATCH_SIZE = 8

const TYPE_PRIORITY: Record<string, number> = {
  person: 5,
  technology: 4,
  module: 3,
  method: 2,
  concept: 1,
}

function simpleHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

function getGraphFilePath(cwd: string): string {
  return path.join(cwd, '.vision', 'graph.json')
}

async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

async function runAgentQuery(prompt: string, cwd: string, effort: 'low' | 'high'): Promise<string> {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const cliPath = resolveClaudeCodeExecutable()

  const env: Record<string, string | undefined> = { ...process.env }
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey
  if (baseUrl && profile?.apiProvider === 'custom') env.ANTHROPIC_BASE_URL = baseUrl

  const options: Options = {
    model,
    cwd,
    allowedTools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'acceptEdits',
    effort,
    includePartialMessages: false,
    env,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
  }

  let result = ''
  let messageStream: Query | null = null
  try {
    messageStream = query({ prompt, options }) as Query

    for await (const message of messageStream) {
      if (message.type === 'result') {
        result = message.result || ''
        break
      }
    }
  } catch (err) {
    console.error('[GraphExtractor] runAgentQuery failed:', err)
  } finally {
    if (messageStream) {
      try { messageStream.abort() } catch {}
    }
  }

  return result
}

function parseExtractionResult(raw: string): { entities: SemanticEntity[]; relations: SemanticRelation[] } {
  try {
    try {
      const data = JSON.parse(raw)
      return {
        entities: Array.isArray(data.entities) ? data.entities : [],
        relations: Array.isArray(data.relations) ? data.relations : [],
      }
    } catch {}

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { entities: [], relations: [] }
    const data = JSON.parse(jsonMatch[0])
    return {
      entities: Array.isArray(data.entities) ? data.entities : [],
      relations: Array.isArray(data.relations) ? data.relations : [],
    }
  } catch {
    return { entities: [], relations: [] }
  }
}

function deduplicateEntities(entities: SemanticEntity[]): SemanticEntity[] {
  const nameMap = new Map<string, SemanticEntity>()
  for (const e of entities) {
    const key = e.name.toLowerCase()
    const existing = nameMap.get(key)
    if (!existing || (TYPE_PRIORITY[e.type] ?? 0) > (TYPE_PRIORITY[existing.type] ?? 0)) {
      nameMap.set(key, e)
    }
  }
  return Array.from(nameMap.values())
}

function deduplicateRelations(relations: SemanticRelation[]): SemanticRelation[] {
  const seen = new Set<string>()
  return relations.filter(r => {
    const key = `${r.from.toLowerCase()}→${r.to.toLowerCase()}→${r.label.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function extractSemanticGraph(
  cwd: string,
  changedFiles: string[],
  onProgress: (phase: string, progress: number) => void
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; skipped?: boolean }> {
  if (changedFiles.length === 0) {
    const existingData = await loadSemanticGraph(cwd)
    return { ...semanticDataToGraph(existingData), skipped: true }
  }

  // Filter to only .md files that exist
  const filesToProcess: string[] = []
  for (const file of changedFiles) {
    if (!file.endsWith('.md')) continue
    try {
      await fs.promises.access(file)
      filesToProcess.push(file)
    } catch {
      // File was deleted, skip
    }
  }

  if (filesToProcess.length === 0) {
    const existingData = await loadSemanticGraph(cwd)
    return { ...semanticDataToGraph(existingData), skipped: true }
  }

  const batches: string[][] = []
  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    batches.push(filesToProcess.slice(i, i + BATCH_SIZE))
  }

  onProgress('extracting', 0.1)

  // Cache file contents to avoid double reads
  const contentCache = new Map<string, string>()

  const batchPromises = batches.map(async (batch, i) => {
    const fileContents: string[] = []
    for (const file of batch) {
      let content = contentCache.get(file)
      if (!content) {
        content = await readFileContent(file)
        contentCache.set(file, content)
      }
      const relPath = path.relative(cwd, file)
      fileContents.push(`--- ${relPath} ---\n${content.slice(0, 3000)}`)
    }

    const prompt = `Analyze the following documents and extract entities and relationships. Return ONLY valid JSON in this exact format:
{"entities": [{"name": "EntityName", "type": "concept|technology|person|module|method", "sourceFile": "relative/path.md"}], "relations": [{"from": "EntityA", "to": "EntityB", "label": "relationship description", "sourceFile": "relative/path.md"}]}

Rules:
- Extract key concepts, technologies, modules, methods, and named entities
- Relations should describe how entities connect (e.g. "depends on", "implements", "uses", "part of")
- Use consistent entity names for deduplication
- sourceFile must be the relative path from the document header

Documents:
${fileContents.join('\n\n')}`

    const result = await runAgentQuery(prompt, cwd, 'low')
    const extracted = parseExtractionResult(result)

    return { extracted, batch, batchIndex: i }
  })

  const batchResults = await Promise.all(batchPromises)

  // Update progress with completed batches
  for (const { batchIndex } of batchResults) {
    onProgress(`extracting batch ${batchIndex + 1}/${batches.length}`, 0.2 + (0.5 * (batchIndex + 1) / batches.length))
  }

  // Collect results
  const existingData = await loadSemanticGraph(cwd)
  const allEntities: SemanticEntity[] = [...existingData.entities]
  const allRelations: SemanticRelation[] = [...existingData.relations]
  const newHashes: Record<string, string> = { ...existingData.fileHashes }

  for (const { extracted, batch } of batchResults) {
    if (extracted.entities.length > 0 || extracted.relations.length > 0) {
      allEntities.push(...extracted.entities)
      allRelations.push(...extracted.relations)
      for (const file of batch) {
        const content = contentCache.get(file) || ''
        newHashes[file] = simpleHash(content)
      }
    }
  }

  // Local dedup
  onProgress('deduplicating', 0.8)
  const dedupedEntities = deduplicateEntities(allEntities)
  const dedupedRelations = deduplicateRelations(allRelations)

  // Save
  onProgress('saving', 0.9)
  const semanticData: SemanticGraphData = {
    entities: dedupedEntities,
    relations: dedupedRelations,
    fileHashes: newHashes,
  }

  const graphDir = path.join(cwd, '.vision')
  await fs.promises.mkdir(graphDir, { recursive: true })
  await fs.promises.writeFile(getGraphFilePath(cwd), JSON.stringify(semanticData, null, 2), 'utf-8')

  onProgress('done', 1)

  return semanticDataToGraph(semanticData)
}

export async function loadSemanticGraph(cwd: string): Promise<SemanticGraphData> {
  try {
    const content = await readFileContent(getGraphFilePath(cwd))
    if (!content) return { entities: [], relations: [], fileHashes: {} }
    return JSON.parse(content)
  } catch {
    return { entities: [], relations: [], fileHashes: {} }
  }
}

export function semanticDataToGraph(data: SemanticGraphData): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = data.entities.map(e => ({
    id: `entity:${e.name}`,
    label: e.name,
    type: 'entity' as const,
    entityType: e.type,
  }))

  const edges: GraphEdge[] = data.relations.map(r => ({
    source: `entity:${r.from}`,
    target: `entity:${r.to}`,
    label: r.label,
    type: 'semantic' as const,
  }))

  return { nodes, edges }
}

export function mergeGraphData(
  wikilinkData: { nodes: GraphNode[]; edges: GraphEdge[] },
  semanticData: { nodes: GraphNode[]; edges: GraphEdge[] }
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>()
  for (const n of wikilinkData.nodes) nodeMap.set(n.id, n)
  for (const n of semanticData.nodes) nodeMap.set(n.id, n)

  const edges = [...wikilinkData.edges, ...semanticData.edges]

  return { nodes: Array.from(nodeMap.values()), edges }
}
