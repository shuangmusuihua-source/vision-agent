import * as fs from 'fs'
import * as path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { getMainWindow } from './ipc-sender'
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

export class FileIndexService {
  private index = new Map<string, IndexedFile>()
  private knowledgeIndex = new Map<string, KnowledgeEntry>()
  private watcher: FSWatcher | null = null
  private workspaceDirs: string[] = []
  private knowledgeBaseDir: string | null = null
  private ready = false
  private readyCallbacks: Array<() => void> = []
  private knowledgeReady = false
  private knowledgeReadyCallbacks: Array<() => void> = []
  private changedFiles = new Map<string, number>()
  private changeVersion = 0
  private knowledgeWatcher: FSWatcher | null = null
  private workspaceInitQueue: Promise<void> = Promise.resolve()

  /** Initialize one searchable index across all authorized workspaces. */
  init(workspaceDirs: string[]): Promise<void> {
    const requestedDirs = [...workspaceDirs]
    const run = this.workspaceInitQueue.then(() => this.performWorkspaceInit(requestedDirs))
    this.workspaceInitQueue = run.catch(() => {})
    return run
  }

  private async performWorkspaceInit(workspaceDirs: string[]): Promise<void> {
    const nextWorkspaceDirs = [...new Set(workspaceDirs.filter(Boolean).map((dir) => path.resolve(dir)))]
    const unchanged = nextWorkspaceDirs.length === this.workspaceDirs.length
      && nextWorkspaceDirs.every((dir, index) => dir === this.workspaceDirs[index])
    if (unchanged && this.ready) return

    await this.destroyWorkspaceIndex()
    this.workspaceDirs = nextWorkspaceDirs
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
  async onReady(): Promise<void> {
    await this.workspaceInitQueue
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
    this.index.clear()

    const mdFiles = (await Promise.all(
      this.workspaceDirs.map((workspaceDir) => this.discoverMarkdownFiles(workspaceDir))
    )).flat()
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
    if (this.workspaceDirs.length === 0) return

    this.watcher = chokidar.watch(this.workspaceDirs, {
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
    this.markFileChanged(filePath)
    this.notifyFileChange()
  }

  /** Handle file deletion */
  private handleFileDelete(filePath: string): void {
    this.index.delete(filePath)
    this.markFileChanged(filePath)
    this.notifyFileChange()
  }

  private markFileChanged(filePath: string): void {
    this.changeVersion += 1
    this.changedFiles.set(filePath, this.changeVersion)
  }

  getChangeVersion(): number {
    return this.changeVersion
  }

  acknowledgeChanges(version: number): { count: number; files: string[]; version: number } {
    for (const [filePath, changedAt] of this.changedFiles) {
      if (changedAt <= version) this.changedFiles.delete(filePath)
    }
    return this.getFileChangeSnapshot()
  }

  getFileChangeSnapshot(): { count: number; files: string[]; version: number } {
    return {
      count: this.changedFiles.size,
      files: Array.from(this.changedFiles.keys()),
      version: this.changeVersion,
    }
  }

  /** Push file change notification to renderer */
  private notifyFileChange(): void {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('graph:filesChanged', this.getFileChangeSnapshot())
    }
  }

  /** Initialize knowledge base watcher and index (separate from main workspace) */
  async initKnowledgeIndex(knowledgeDir: string): Promise<void> {
    await this.destroyKnowledgeIndex()
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
        this.markFileChanged(filePath)
        this.notifyFileChange()
      }
    })
    this.knowledgeWatcher.on('change', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.indexKnowledgeFile(filePath)
        this.markFileChanged(filePath)
        this.notifyFileChange()
      }
    })
    this.knowledgeWatcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.md')) {
        this.knowledgeIndex.delete(filePath)
        this.markFileChanged(filePath)
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
    const edgeKeys = new Set<string>()
    const filePathToId = new Map<string, string>()

    for (const [filePath] of this.knowledgeIndex) {
      const label = path.basename(filePath, '.md')
      const id = filePath
      nodes.push({ id, label, type: 'file' })
      filePathToId.set(filePath, id)
    }

    const labelToIds = new Map<string, string[]>()
    for (const node of nodes) {
      const ids = labelToIds.get(node.label) || []
      ids.push(node.id)
      labelToIds.set(node.label, ids)
    }

    for (const [, data] of this.knowledgeIndex) {
      const sourceId = filePathToId.get(data.filePath)
      if (!sourceId) continue
      for (const rawLink of data.wikilinks) {
        const link = rawLink.split('|')[0].split('#')[0].trim()
        if (!link) continue
        const linkPath = link.toLowerCase().endsWith('.md') ? link : `${link}.md`
        const relativeCandidate = path.resolve(path.dirname(data.filePath), linkPath)
        const rootCandidate = this.knowledgeBaseDir
          ? path.resolve(this.knowledgeBaseDir, linkPath)
          : null
        const label = path.basename(linkPath, '.md')
        const labelMatches = labelToIds.get(label) || []
        const targetId = filePathToId.get(relativeCandidate)
          || (rootCandidate ? filePathToId.get(rootCandidate) : undefined)
          || (labelMatches.length === 1 ? labelMatches[0] : undefined)
        if (targetId) {
          if (sourceId !== targetId) {
            const [source, target] = sourceId < targetId
              ? [sourceId, targetId]
              : [targetId, sourceId]
            const edgeKey = JSON.stringify([source, target])
            if (!edgeKeys.has(edgeKey)) {
              edgeKeys.add(edgeKey)
              edges.push({ source, target, type: 'reference' })
            }
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

  async listMarkdownFilesUnder(rootPath: string): Promise<Array<{ label: string; path: string }>> {
    await Promise.all([this.onReady(), this.onKnowledgeReady()])
    const root = path.resolve(rootPath)
    const files = new Set([...this.index.keys(), ...this.knowledgeIndex.keys()])
    return [...files]
      .filter((filePath) => {
        const relativePath = path.relative(root, filePath)
        return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
      })
      .sort((left, right) => left.localeCompare(right))
      .map((filePath) => ({ label: path.basename(filePath, '.md'), path: filePath }))
  }

  /** Get content of a specific file from index */
  getFileContent(filePath: string): string | undefined {
    return this.index.get(filePath)?.content
  }

  /** Clean up */
  async destroyWorkspaceIndex(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.index.clear()
    this.workspaceDirs = []
    this.readyCallbacks.forEach((cb) => cb())
    this.ready = false
    this.readyCallbacks = []
  }

  async destroyKnowledgeIndex(): Promise<void> {
    if (this.knowledgeWatcher) {
      await this.knowledgeWatcher.close()
      this.knowledgeWatcher = null
    }
    this.knowledgeIndex.clear()
    this.knowledgeBaseDir = null
    this.knowledgeReadyCallbacks.forEach((cb) => cb())
    this.knowledgeReady = false
    this.knowledgeReadyCallbacks = []
  }

  /** Clean up all indexes and watchers. */
  async destroy(): Promise<void> {
    await this.workspaceInitQueue
    await this.destroyWorkspaceIndex()
    await this.destroyKnowledgeIndex()
    this.changedFiles.clear()
    this.changeVersion = 0
  }
}

// Singleton
export const fileIndexService = new FileIndexService()
