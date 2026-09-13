import { lstat, readdir } from 'fs/promises'
import { join, relative, resolve } from 'path'
import type { CurationDraft, CurationSaveRequest, KnowledgeCatalog, KnowledgeDocument } from '../shared/curation-types'
import { CURATION_TEXT_MAX_BYTES, readTextSnapshot, replaceSnapshot, assertSnapshotsCurrent, textHash, type TextSnapshot } from './curation-files'
import { CurationDrafts } from './curation-jobs'
import { distillKnowledge, type KnowledgeSource, type TopicCandidate } from './knowledge-distiller'
import { parseFrontmatter } from './vendor/tencent-agent-memory/frontmatter'
import type { LlmClient } from './vendor/tencent-agent-memory/llm'

interface SourceState { hash: string; topics: string[] }
interface JournalFile { path: string; before: string | null; after: string }
interface LibraryState {
  version: 1
  sources: Record<string, SourceState>
  journal?: { files: JournalFile[]; previousSources: Record<string, SourceState>; complete: boolean }
}
interface KnowledgeDraftState {
  sources: TextSnapshot[]
  files: Array<{ id: string; snapshot: TextSnapshot; sourceIds: string[] }>
  sourceIds: Map<string, string>
  validate: () => void | Promise<void>
}

function validRelativeMarkdown(path: unknown, topic = false): path is string {
  return typeof path === 'string' && path.endsWith('.md') && !path.startsWith('/') && !path.includes('\\')
    && path.split('/').every(part => part && part !== '.' && part !== '..') && (!topic || path.startsWith('topics/'))
}

function validSources(value: unknown): value is Record<string, SourceState> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([path, source]) => (
    validRelativeMarkdown(path) && !!source && typeof source.hash === 'string' && /^[a-f0-9]{64}$/.test(source.hash)
    && Array.isArray(source.topics) && source.topics.every((topic: unknown) => validRelativeMarkdown(topic, true))
  ))
}

const STATE_PATH = '.sumi/knowledge-curation.json'
const STATE_MAX_BYTES = 64_000_000

/** Owns derived-topic state and the last reversible commit. Import provenance remains in knowledge-curation.ts. */
export class KnowledgeLibrary {
  private drafts = new CurationDrafts<KnowledgeDraftState>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly root: string
  constructor(root: string) { this.root = resolve(root) }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(operation)
    this.queue = next
    return next
  }

  private async readState(): Promise<{ state: LibraryState; snapshot: TextSnapshot }> {
    const snapshot = await readTextSnapshot(this.root, join(this.root, STATE_PATH), STATE_MAX_BYTES)
    if (snapshot.content === null) return { snapshot, state: { version: 1, sources: {} } }
    const state = JSON.parse(snapshot.content) as LibraryState
    if (state?.version !== 1 || !validSources(state.sources)
      || (state.journal && (!Array.isArray(state.journal.files) || state.journal.files.length > 24
        || typeof state.journal.complete !== 'boolean' || !validSources(state.journal.previousSources)
        || new Set(state.journal.files.map(file => file.path)).size !== state.journal.files.length
        || !state.journal.files.every(file => validRelativeMarkdown(file.path, true) && typeof file.after === 'string'
          && (file.before === null || typeof file.before === 'string'))))) {
      throw new Error('知识整理记录无效，请恢复该记录后重试')
    }
    return { state, snapshot }
  }

  private async scan(): Promise<Array<{ document: KnowledgeDocument; snapshot: TextSnapshot }>> {
    const { state } = await this.readState()
    const result: Array<{ document: KnowledgeDocument; snapshot: TextSnapshot }> = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
        if (result.length >= 1000) throw new Error('知识库文件过多，请缩小目录范围')
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { await walk(path); continue }
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const metadata = await lstat(path)
        if (metadata.size > CURATION_TEXT_MAX_BYTES) {
          result.push({ snapshot: { path, content: null, hash: null }, document: {
            path, title: entry.name.slice(0, -3), description: '', modifiedAt: metadata.mtimeMs,
            kind: relative(this.root, path).startsWith('topics/') ? 'topic' : 'source', status: 'new',
            unavailableReason: '文件超过 1 MB，请拆分后整理',
          } })
          continue
        }
        const snapshot = await readTextSnapshot(this.root, path)
        if (snapshot.content === null) continue
        const rel = relative(this.root, path).split('\\').join('/')
        const parsed = parseFrontmatter(snapshot.content)
        const saved = Object.hasOwn(state.sources, rel) ? state.sources[rel] : undefined
        const topicsExist = saved && await Promise.all(saved.topics.map(async topic => {
          try { return (await lstat(join(this.root, topic))).isFile() } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
            throw error
          }
        })).then(values => values.every(Boolean))
        result.push({ snapshot, document: {
          path, title: typeof parsed.frontmatter.title === 'string' ? parsed.frontmatter.title : entry.name.slice(0, -3),
          description: typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description : '',
          kind: rel.startsWith('topics/') ? 'topic' : 'source', modifiedAt: (await lstat(path)).mtimeMs,
          status: saved && topicsExist ? saved.hash === snapshot.hash ? 'current' : 'changed' : 'new',
        } })
      }
    }
    await walk(this.root)
    return result
  }

  async catalog(): Promise<KnowledgeCatalog> {
    const entries = await this.scan()
    return { documents: entries.map(entry => entry.document), canUndo: Boolean((await this.readState()).state.journal) }
  }

  async prepare(owner: number, paths: string[], llm: LlmClient, validate: () => void | Promise<void> = () => {}): Promise<CurationDraft> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 8 || paths.some(path => typeof path !== 'string')) throw new Error('请选择 1 至 8 份资料')
    await validate()
    const entries = await this.scan()
    const selected = [...new Set(paths.map(path => resolve(path)))].map(path => {
      const entry = entries.find(item => item.snapshot.path === path && item.document.kind === 'source')
      if (!entry) throw new Error('所选文件不属于知识库原始资料')
      if (entry.document.unavailableReason) throw new Error(entry.document.unavailableReason)
      return entry
    })
    const changed = selected.filter(entry => entry.document.status !== 'current')
    const sources = entries.filter(entry => entry.document.kind === 'source' && entry.snapshot.content !== null).map(entry => ({
      id: `s${textHash(relative(this.root, entry.snapshot.path)).slice(0, 16)}`,
      path: relative(this.root, entry.snapshot.path).split('\\').join('/'), content: entry.snapshot.content!,
    } satisfies KnowledgeSource))
    const existing: TopicCandidate[] = entries.filter(entry => entry.document.kind === 'topic' && entry.snapshot.content !== null).map(entry => ({
      path: relative(this.root, entry.snapshot.path).split('\\').join('/'), title: entry.document.title,
      content: entry.snapshot.content!, sourceIds: [],
    }))
    const toDistill = sources.filter(source => changed.some(entry => entry.snapshot.path === join(this.root, source.path)))
    if (toDistill.reduce((size, source) => size + source.content.length, 0) > 200_000) throw new Error('资料总量较大，请分批整理（每批最多 20 万字符）')
    const topics = toDistill.length ? await distillKnowledge(toDistill, existing, sources, llm) : []
    await validate()
    const files = await Promise.all(topics.map(async topic => ({
      id: topic.path, snapshot: entries.find(entry => entry.snapshot.path === join(this.root, topic.path))?.snapshot
        || { path: join(this.root, topic.path), content: null, hash: null }, sourceIds: topic.sourceIds,
    })))
    // Match the exact versions used by the model, not newer versions read after generation.
    await assertSnapshotsCurrent(this.root, [...selected.map(entry => entry.snapshot), ...files.map(file => file.snapshot)])
    await validate()
    return this.drafts.add(owner, {
      kind: 'knowledge', title: '整理知识',
      notice: topics.length ? `${changed.length} 份资料，${topics.length} 个主题。保存前可以调整内容。` : '这些资料没有变化，已跳过重复整理。',
      files: topics.map((topic, index) => ({ id: topic.path, title: topic.title, before: files[index].snapshot.content, content: topic.content })),
    }, { sources: changed.map(entry => entry.snapshot), files, sourceIds: new Map(sources.map(source => [source.id, source.path])), validate })
  }

  discard(owner: number, id: string): void { this.drafts.discard(owner, id) }
  discardOwner(owner: number): void { this.drafts.discardOwner(owner) }

  save(owner: number, request: CurationSaveRequest): Promise<string[]> {
    return this.serialize(async () => {
      const { value: draft } = this.drafts.get(owner, request.draftId)
      await draft.validate()
      if (!Array.isArray(request.files) || request.files.length !== draft.files.length || !draft.files.length
        || new Set(request.files.map(file => file.id)).size !== draft.files.length) throw new Error('请保存完整的整理草稿')
      const files: JournalFile[] = draft.files.map(file => {
        const edit = request.files.find(item => item.id === file.id)
        if (!edit || typeof edit.content !== 'string' || !edit.content.trim() || edit.content.length > 200_000) throw new Error('主题正文无效')
        return { path: file.id, before: file.snapshot.content, after: edit.content }
      })
      await assertSnapshotsCurrent(this.root, [...draft.sources, ...draft.files.map(file => file.snapshot)])
      const { state, snapshot } = await this.readState()
      if (state.journal && !state.journal.complete) throw new Error('上次保存被中断，请先撤回上次整理')
      const journal = { files, previousSources: state.sources, complete: false }
      const pending = JSON.stringify({ ...state, journal })
      if (Buffer.byteLength(pending) > STATE_MAX_BYTES - 1_000_000) throw new Error('本次整理记录过大，请减少主题后重试')
      await replaceSnapshot(this.root, snapshot, pending)
      for (const file of draft.files) {
        await draft.validate()
        await replaceSnapshot(this.root, file.snapshot, files.find(item => item.path === file.id)!.after)
      }
      const nextSources = { ...state.sources }
      for (const source of draft.sources) {
        const rel = relative(this.root, source.path).split('\\').join('/')
        const topics = draft.files.filter(file => file.sourceIds.some(id => draft.sourceIds.get(id) === rel)).map(file => file.id)
        nextSources[rel] = { hash: source.hash!, topics }
      }
      await replaceSnapshot(this.root, { ...snapshot, content: pending }, JSON.stringify({ version: 1, sources: nextSources, journal: { ...journal, complete: true } }))
      this.drafts.discard(owner, request.draftId)
      return files.map(file => join(this.root, file.path))
    })
  }

  undo(): Promise<void> {
    return this.serialize(async () => {
      const { state, snapshot } = await this.readState()
      if (!state.journal) throw new Error('没有可以撤回的整理')
      const snapshots = await Promise.all(state.journal.files.map(async file => {
        if (!file.path.startsWith('topics/') || typeof file.after !== 'string' || (file.before !== null && typeof file.before !== 'string')) throw new Error('整理记录无效')
        const current = await readTextSnapshot(this.root, join(this.root, file.path))
        if (current.content !== file.after && current.content !== file.before) throw new Error('主题已被编辑，无法直接撤回；请先保留当前修改')
        return { current, before: file.before }
      }))
      for (const { current, before } of snapshots) if (current.content !== before) await replaceSnapshot(this.root, current, before)
      await replaceSnapshot(this.root, snapshot, JSON.stringify({ version: 1, sources: state.journal.previousSources }))
    })
  }
}
