import * as fs from 'fs'
import * as path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { getMainWindow } from './ipc-sender'
import type { GraphNode, GraphEdge, GraphData } from '../shared/types'
import type { FileChangeBatch, FileChangeSnapshot, FileRenameChange } from '../shared/ipc-types'

interface IndexedFile {
  filePath: string
  fileId: string
  lines: string[]
  normalizedLines: string[]
  mtimeMs: number
}

interface RecentFileLocation {
  filePath: string
  seenAt: number
}

const FILE_RENAME_PAIR_WINDOW_MS = 5_000
const FILE_CHANGE_BATCH_MS = 50

interface KnowledgeEntry {
  filePath: string
  wikilinks: string[]
  mtimeMs: number
}

const IGNORED_INDEX_PATH_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.claude',
  '.sumi',
  'out',
  'dist',
])

/** Keep discovery and chokidar filters aligned without matching partial file names. */
export function shouldIgnoreIndexPath(filePath: string): boolean {
  return filePath.split(/[\\/]+/).some((segment) => IGNORED_INDEX_PATH_SEGMENTS.has(segment))
}

export class FileIndexService {
  private index = new Map<string, IndexedFile>()
  private knowledgeIndex = new Map<string, KnowledgeEntry>()
  private watcher: FSWatcher | null = null
  private workspaceDirs: string[] = []
  private knowledgeBaseDir: string | null = null
  private ready = false
  private knowledgeReady = false
  private knowledgeReadyCallbacks: Array<() => void> = []
  private changedFiles = new Map<string, number>()
  private changedRenames = new Map<string, { change: FileRenameChange; version: number }>()
  private recentAddedFiles = new Map<string, RecentFileLocation>()
  private recentRemovedFiles = new Map<string, RecentFileLocation>()
  private changeVersion = 0
  private pendingFiles = new Set<string>()
  private pendingRenames: FileRenameChange[] = []
  private notificationTimer: ReturnType<typeof setTimeout> | null = null
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
    const existingWorkspaceDirs = new Set(this.workspaceDirs)
    const hasSameWorkspaceRoots = nextWorkspaceDirs.length === existingWorkspaceDirs.size
      && nextWorkspaceDirs.every((dir) => existingWorkspaceDirs.has(dir))
    if (hasSameWorkspaceRoots && this.ready) {
      // Sidebar order is presentation metadata. Existing index entries and the
      // watcher remain valid when the configured root set itself is unchanged.
      this.workspaceDirs = nextWorkspaceDirs
      return
    }

    await this.destroyWorkspaceIndex()
    this.workspaceDirs = nextWorkspaceDirs
    this.ready = false

    // Build initial index
    await this.buildFullIndex()

    // Start watching
    this.startWatching()

    this.ready = true
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

    const walk = async (currentDir: string) => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (shouldIgnoreIndexPath(fullPath)) continue
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath)
        }
      }
    }

    await walk(dir)
    return results
  }

  /** Index a single file */
  private async indexFile(filePath: string): Promise<IndexedFile | null> {
    try {
      const stat = await fs.promises.stat(filePath)
      const existing = this.index.get(filePath)
      const fileId = `${stat.dev}:${stat.ino}`
      if (existing && existing.mtimeMs === stat.mtimeMs && existing.fileId === fileId) return existing

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      const indexedFile = {
        filePath,
        fileId,
        lines,
        normalizedLines: lines.map((line) => line.toLowerCase()),
        mtimeMs: stat.mtimeMs
      }
      this.index.set(filePath, indexedFile)
      return indexedFile
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        this.index.delete(filePath)
      }
      console.error(`[FileIndexService] failed to index file ${filePath}:`, err)
      return null
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
      ignored: shouldIgnoreIndexPath,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    })

    this.watcher.on('add', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileChange(filePath, 'add')
    })
    this.watcher.on('change', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileChange(filePath, 'change')
    })
    this.watcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.md')) this.handleFileDelete(filePath)
    })
    this.watcher.on('error', (err) => {
      console.error('[FileIndexService] watcher error:', err)
    })
  }

  /** Handle a single file change event */
  private async handleFileChange(filePath: string, kind: 'add' | 'change' = 'change'): Promise<void> {
    let indexedFile: IndexedFile | null = null
    try {
      const stat = await fs.promises.stat(filePath)
      if (stat.isFile()) {
        indexedFile = await this.indexFile(filePath)
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
    if (kind === 'add' && indexedFile) this.rememberAddedFile(indexedFile)
    this.notifyFileChange()
  }

  /** Handle file deletion */
  private handleFileDelete(filePath: string): void {
    const indexedFile = this.index.get(filePath)
    this.index.delete(filePath)
    this.markFileChanged(filePath)
    if (indexedFile) this.rememberRemovedFile(indexedFile)
    this.notifyFileChange()
  }

  private rememberAddedFile(file: IndexedFile): void {
    this.pruneRecentFileLocations()
    const removed = this.recentRemovedFiles.get(file.fileId)
    if (removed) {
      this.recentRemovedFiles.delete(file.fileId)
      this.recordFileRename(removed.filePath, file.filePath)
      return
    }
    this.recentAddedFiles.set(file.fileId, { filePath: file.filePath, seenAt: Date.now() })
  }

  private rememberRemovedFile(file: IndexedFile): void {
    this.pruneRecentFileLocations()
    const added = this.recentAddedFiles.get(file.fileId)
    if (added) {
      this.recentAddedFiles.delete(file.fileId)
      this.recordFileRename(file.filePath, added.filePath)
      return
    }
    this.recentRemovedFiles.set(file.fileId, { filePath: file.filePath, seenAt: Date.now() })
  }

  private recordFileRename(from: string, to: string): void {
    if (from === to) return
    const change = { from, to }
    this.pendingRenames.push(change)
    this.changedRenames.set(JSON.stringify([from, to]), {
      change,
      version: this.changeVersion,
    })
  }

  private pruneRecentFileLocations(now = Date.now()): void {
    for (const [fileId, entry] of this.recentAddedFiles) {
      if (now - entry.seenAt > FILE_RENAME_PAIR_WINDOW_MS) this.recentAddedFiles.delete(fileId)
    }
    for (const [fileId, entry] of this.recentRemovedFiles) {
      if (now - entry.seenAt > FILE_RENAME_PAIR_WINDOW_MS) this.recentRemovedFiles.delete(fileId)
    }
  }

  private markFileChanged(filePath: string): void {
    this.changeVersion += 1
    this.changedFiles.set(filePath, this.changeVersion)
    this.pendingFiles.add(filePath)
  }

  getChangeVersion(): number {
    return this.changeVersion
  }

  acknowledgeChanges(version: number): FileChangeSnapshot {
    for (const [filePath, changedAt] of this.changedFiles) {
      if (changedAt <= version) this.changedFiles.delete(filePath)
    }
    for (const [key, rename] of this.changedRenames) {
      if (rename.version <= version) this.changedRenames.delete(key)
    }
    return this.getFileChangeSnapshot()
  }

  getFileChangeSnapshot(): FileChangeSnapshot {
    return {
      count: this.changedFiles.size,
      files: Array.from(this.changedFiles.keys()),
      version: this.changeVersion,
      renames: Array.from(this.changedRenames.values(), ({ change }) => change),
    }
  }

  /** Bound notification frequency without resending previously delivered paths. */
  private notifyFileChange(): void {
    if (this.notificationTimer) return
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = null
      const batch: FileChangeBatch = {
        count: this.changedFiles.size,
        version: this.changeVersion,
        files: [...this.pendingFiles],
        renames: this.pendingRenames,
      }
      this.pendingFiles.clear()
      this.pendingRenames = []
      const window = getMainWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send('graph:filesChanged', batch)
      }
    }, FILE_CHANGE_BATCH_MS)
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
      ignored: shouldIgnoreIndexPath,
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

    return { nodes, edges, changeVersion: this.changeVersion }
  }

  /** Search files by query string */
  search(query: string, limit = 50): Array<{ filePath: string; line: number; snippet: string }> {
    const results: Array<{ filePath: string; line: number; snippet: string }> = []
    const lowerQuery = query.toLowerCase()

    for (const [, data] of this.index) {
      if (results.length >= limit) break

      for (let i = 0; i < data.lines.length; i++) {
        if (results.length >= limit) break

        const line = data.lines[i]
        const matchIndex = data.normalizedLines[i].indexOf(lowerQuery)
        if (matchIndex >= 0) {
          const start = Math.max(0, matchIndex - 30)
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

  /** Clean up */
  async destroyWorkspaceIndex(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.index.clear()
    this.recentAddedFiles.clear()
    this.recentRemovedFiles.clear()
    this.workspaceDirs = []
    this.ready = false
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
    if (this.notificationTimer) clearTimeout(this.notificationTimer)
    this.notificationTimer = null
    this.pendingFiles.clear()
    this.pendingRenames = []
    this.changedFiles.clear()
    this.changedRenames.clear()
    this.changeVersion = 0
  }
}

// Singleton
export const fileIndexService = new FileIndexService()
