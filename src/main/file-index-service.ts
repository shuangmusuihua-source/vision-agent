import * as fs from 'fs'
import * as path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { getMainWindow } from './index'
import type { GraphNode, GraphEdge, GraphData } from '../shared/types'

interface IndexedFile {
  filePath: string
  content: string
  wikilinks: string[]
  mtimeMs: number
}

interface KnowledgeEntry {
  filePath: string
  wikilinks: string[]
  mtimeMs: number
}

class FileIndexService {
  private index = new Map<string, IndexedFile>()
  private knowledgeIndex = new Map<string, KnowledgeEntry>()
  private watcher: FSWatcher | null = null
  private workspaceDir: string | null = null
  private knowledgeBaseDir: string | null = null
  private ready = false
  private readyCallbacks: Array<() => void> = []
  private knowledgeReady = false
  private knowledgeReadyCallbacks: Array<() => void> = []
  private changedFiles = new Set<string>()
  private knowledgeWatcher: FSWatcher | null = null

  /** Initialize index for a workspace directory */
  async init(workspaceDir: string): Promise<void> {
    if (this.workspaceDir === workspaceDir && this.ready) return

    this.destroy()
    this.workspaceDir = workspaceDir
    this.ready = false

    // Build initial index
    await this.buildFullIndex()

    // Start watching
    this.startWatching()

    this.ready = true
    this.readyCallbacks.forEach((cb) => cb())
    this.readyCallbacks = []
  }

  /** Wait until index is ready */
  onReady(): Promise<void> {
    if (this.ready || !this.workspaceDir) return Promise.resolve()
    return new Promise((resolve) => {
      this.readyCallbacks.push(resolve)
    })
  }

  /** Wait until knowledge index is ready */
  onKnowledgeReady(): Promise<void> {
    if (this.knowledgeReady || !this.knowledgeBaseDir) return Promise.resolve()
    return new Promise((resolve) => {
      this.knowledgeReadyCallbacks.push(resolve)
    })
  }

  /** Full scan of workspace */
  private async buildFullIndex(): Promise<void> {
    if (!this.workspaceDir) return
    this.index.clear()

    const mdFiles = await this.discoverMarkdownFiles(this.workspaceDir)
    const batchSize = 20
    for (let i = 0; i < mdFiles.length; i += batchSize) {
      const batch = mdFiles.slice(i, i + batchSize)
      await Promise.all(batch.map((fp) => this.indexFile(fp)))
    }
  }

  /** Discover all .md files recursively */
  private async discoverMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    const ignoredDirs = new Set(['.git', 'node_modules', '.vision', '.claude', 'out', 'dist'])

    const walk = async (currentDir: string) => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            await walk(fullPath)
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath)
        }
      }
    }

    await walk(dir)
    return results
  }

  /** Index a single file */
  private async indexFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(filePath)
      const existing = this.index.get(filePath)
      if (existing && existing.mtimeMs === stat.mtimeMs) return

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const wikilinks = this.extractWikilinks(content)

      this.index.set(filePath, {
        filePath,
        content,
        wikilinks,
        mtimeMs: stat.mtimeMs
      })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        this.index.delete(filePath)
      }
      console.error(`[FileIndexService] failed to index file ${filePath}:`, err)
    }
  }

  /** Extract [[wikilinks]] from content */
  private extractWikilinks(content: string): string[] {
    const links: string[] = []
    const regex = /\[\[([^\]]+)\]\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      links.push(match[1])
    }
    return links
  }

  /** Start chokidar for incremental updates */
  private startWatching(): void {
    if (!this.workspaceDir) return

    this.watcher = chokidar.watch(this.workspaceDir, {
      ignored: /(^|[\/\\])\.(git|vision|claude)|node_modules|out|dist/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    })

    this.watcher.on('add', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileChange(filePath)
    })
    this.watcher.on('change', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileChange(filePath)
    })
    this.watcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileDelete(filePath)
    })
    this.watcher.on('error', (err) => {
      console.error('[FileIndexService] watcher error:', err)
    })
  }

  /** Handle a single file change event */
  private async handleFileChange(filePath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(filePath)
      if (stat.isFile()) {
        await this.indexFile(filePath)
      } else {
        this.index.delete(filePath)
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        this.index.delete(filePath)
      }
      console.error(`[FileIndexService] handleFileChange failed for ${filePath}:`, err)
    }
    this.changedFiles.add(filePath)
    this.notifyFileChange()
  }

  /** Handle file deletion */
  private handleFileDelete(filePath: string): void {
    this.index.delete(filePath)
    this.changedFiles.add(filePath)
    this.notifyFileChange()
  }

  /** Push file change notification to renderer */
  private notifyFileChange(): void {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('graph:filesChanged', {
        count: this.changedFiles.size,
        files: Array.from(this.changedFiles),
      })
    }
  }

  /** Initialize knowledge base watcher and index (separate from main workspace) */
  async initKnowledgeIndex(knowledgeDir: string): Promise<void> {
    if (this.knowledgeWatcher) {
      await this.knowledgeWatcher.close()
      this.knowledgeWatcher = null
    }
    this.knowledgeBaseDir = knowledgeDir

    // Build initial knowledge base index
    await this.buildKnowledgeIndex()

    this.knowledgeReady = true
    this.knowledgeReadyCallbacks.forEach((cb) => cb())
    this.knowledgeReadyCallbacks = []

    this.knowledgeWatcher = chokidar.watch(knowledgeDir, {
      ignored: /(^|[\/\\])\.(git|vision|claude)|node_modules|out|dist/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    })

    this.knowledgeWatcher.on('add', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.indexKnowledgeFile(filePath)
        this.changedFiles.add(filePath)
        this.notifyFileChange()
      }
    })
    this.knowledgeWatcher.on('change', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.indexKnowledgeFile(filePath)
        this.changedFiles.add(filePath)
        this.notifyFileChange()
      }
    })
    this.knowledgeWatcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.md')) {
        this.knowledgeIndex.delete(filePath)
        this.changedFiles.add(filePath)
        this.notifyFileChange()
      }
    })
    this.knowledgeWatcher.on('error', (err) => {
      console.error('[FileIndexService] knowledge watcher error:', err)
    })
  }

  /** Build index of all .md files in the knowledge base */
  private async buildKnowledgeIndex(): Promise<void> {
    if (!this.knowledgeBaseDir) return
    this.knowledgeIndex.clear()

    const mdFiles = await this.discoverMarkdownFiles(this.knowledgeBaseDir)
    const batchSize = 20
    for (let i = 0; i < mdFiles.length; i += batchSize) {
      const batch = mdFiles.slice(i, i + batchSize)
      await Promise.all(batch.map((fp) => this.indexKnowledgeFile(fp)))
    }
  }

  /** Index a single knowledge base file */
  private async indexKnowledgeFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(filePath)
      const existing = this.knowledgeIndex.get(filePath)
      if (existing && existing.mtimeMs === stat.mtimeMs) return

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const wikilinks = this.extractWikilinks(content)

      this.knowledgeIndex.set(filePath, {
        filePath,
        wikilinks,
        mtimeMs: stat.mtimeMs
      })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        this.knowledgeIndex.delete(filePath)
      }
      console.error(`[FileIndexService] failed to index knowledge file ${filePath}:`, err)
    }
  }

  /** Get graph data from knowledge base files only */
  getKnowledgeGraphData(): GraphData {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    for (const [filePath, data] of this.knowledgeIndex) {
      const label = path.basename(filePath, '.md')
      const isMemory = filePath.includes(`${path.sep}.vision${path.sep}memory${path.sep}`)
      const id = isMemory ? `memory:${label}` : filePath
      nodes.push({ id, label, type: isMemory ? 'memory' : 'file' })
    }

    const labelToId = new Map<string, string>()
    for (const node of nodes) {
      labelToId.set(node.label, node.id)
    }

    for (const [, data] of this.knowledgeIndex) {
      for (const link of data.wikilinks) {
        const targetId = labelToId.get(link)
        if (targetId) {
          const sourceLabel = path.basename(data.filePath, '.md')
          const sourceId = labelToId.get(sourceLabel)
          if (sourceId && sourceId !== targetId) {
            edges.push({ source: sourceId, target: targetId, type: 'reference' })
          }
        }
      }
    }

    return { nodes, edges }
  }

  /** Search files by query string */
  search(query: string, limit = 50): Array<{ filePath: string; line: number; snippet: string }> {
    const results: Array<{ filePath: string; line: number; snippet: string }> = []
    const lowerQuery = query.toLowerCase()

    for (const [, data] of this.index) {
      if (results.length >= limit) break

      const lines = data.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= limit) break

        const line = lines[i]
        if (line.toLowerCase().includes(lowerQuery)) {
          const start = Math.max(0, line.toLowerCase().indexOf(lowerQuery) - 30)
          const end = Math.min(line.length, start + query.length + 60)
          results.push({
            filePath: data.filePath,
            line: i + 1,
            snippet: line.slice(start, end)
          })
        }
      }
    }

    return results
  }

  /** List all indexed markdown files */
  listFiles(): string[] {
    return [...this.index.keys()]
  }

  /** Get content of a specific file from index */
  getFileContent(filePath: string): string | undefined {
    return this.index.get(filePath)?.content
  }

  /** Clean up */
  destroy(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.knowledgeWatcher) {
      this.knowledgeWatcher.close()
      this.knowledgeWatcher = null
    }
    this.index.clear()
    this.knowledgeIndex.clear()
    this.workspaceDir = null
    this.knowledgeBaseDir = null
    this.readyCallbacks.forEach((cb) => cb())
    this.knowledgeReadyCallbacks.forEach((cb) => cb())
    this.ready = false
    this.readyCallbacks = []
    this.knowledgeReady = false
    this.knowledgeReadyCallbacks = []
    this.changedFiles.clear()
  }
}

// Singleton
export const fileIndexService = new FileIndexService()
