import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeLibrary } from '../src/main/knowledge-library'
import { distillKnowledge } from '../src/main/knowledge-distiller'
import { mergePage } from '../src/main/vendor/tencent-agent-memory/merge'
import { parseFileBlocks } from '../src/main/vendor/tencent-agent-memory/file-protocol'
import { buildPage } from '../src/main/vendor/tencent-agent-memory/frontmatter'
import { atomicCompareWriteTextFile, atomicWriteTextFile } from '../src/main/atomic-write'
import { readTextSnapshot } from '../src/main/curation-files'

const roots: string[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'sumi-knowledge-test-')); roots.push(root)
  const path = join(root, '资料.md'); await writeFile(path, '# 原始资料\n事实 A')
  return { root, path, library: new KnowledgeLibrary(root) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const block = (body: string) => `<<<FILE path="wiki/concepts/research.md">>>\n${buildPage({ type: 'concept', title: 'Research', description: '研究方法' }, body)}<<<END>>>`
const fakeModel = () => ({ chat: vi.fn(async ({ system, prompt }: { system: string; prompt: string }) => {
  if (system.includes('analyst')) return '提取 Research'
  const sourceId = prompt.match(/s[a-f0-9]{16}/)?.[0]
  return block(`事实 A [来源](source:${sourceId})`)
}) })

describe('reviewed personal knowledge', () => {
  it('prepares without writes, saves citations, skips unchanged sources, and undoes after restart', async () => {
    const { root, path, library } = await setup()
    const llm = fakeModel()
    const draft = await library.prepare(7, [path], llm)
    expect(await readdir(root)).toEqual(['资料.md'])
    expect(draft.files[0].content).toContain('../../%E8%B5%84%E6%96%99.md')
    expect(draft.files[0].content).toContain('[[资料|资料]]')
    const [topicPath] = await library.save(7, { draftId: draft.id, files: draft.files })
    expect(await readFile(path, 'utf8')).toBe('# 原始资料\n事实 A')
    expect((await library.catalog()).documents.find(file => file.path === path)?.status).toBe('current')
    const count = llm.chat.mock.calls.length
    expect((await library.prepare(7, [path], llm)).files).toEqual([])
    expect(llm.chat).toHaveBeenCalledTimes(count)
    await new KnowledgeLibrary(root).undo()
    await expect(readFile(topicPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await library.catalog()).documents[0].status).toBe('new')
  })

  it('rejects a different window and source edits while a draft is open', async () => {
    const { path, library } = await setup()
    const draft = await library.prepare(7, [path], fakeModel())
    await expect(library.save(9, { draftId: draft.id, files: draft.files })).rejects.toThrow('过期')
    await writeFile(path, 'user edit')
    await expect(library.save(7, { draftId: draft.id, files: draft.files })).rejects.toThrow('已更新')
    expect((await library.catalog()).canUndo).toBe(false)
  })

  it('does not adopt a new target created during generation', async () => {
    const { root, path, library } = await setup()
    const llm = fakeModel()
    const original = llm.chat.getMockImplementation()!
    llm.chat.mockImplementation(async args => {
      if (!args.system.includes('analyst')) {
        await mkdir(join(root, 'topics/concepts'), { recursive: true })
        await writeFile(join(root, 'topics/concepts/research.md'), 'manual new topic')
      }
      return original(args)
    })
    await expect(library.prepare(7, [path], llm)).rejects.toThrow('已更新')
    expect(await readFile(join(root, 'topics/concepts/research.md'), 'utf8')).toBe('manual new topic')
  })

  it('protects topics edited after saving when undo is requested', async () => {
    const { path, library } = await setup()
    const draft = await library.prepare(7, [path], fakeModel())
    const [topic] = await library.save(7, { draftId: draft.id, files: draft.files })
    await writeFile(topic, 'my corrected conclusion')
    await expect(library.undo()).rejects.toThrow('已被编辑')
    expect(await readFile(topic, 'utf8')).toBe('my corrected conclusion')
  })

  it('recovers an interrupted multi-file commit without overwriting other files', async () => {
    const { root, library } = await setup()
    await mkdir(join(root, '.sumi')); await mkdir(join(root, 'topics'))
    await writeFile(join(root, 'topics/a.md'), 'after A')
    await writeFile(join(root, 'topics/b.md'), 'before B')
    await writeFile(join(root, '.sumi/knowledge-curation.json'), JSON.stringify({ version: 1, sources: {}, journal: {
      complete: false, previousSources: {}, files: [
        { path: 'topics/a.md', before: null, after: 'after A' },
        { path: 'topics/b.md', before: 'before B', after: 'after B' },
      ],
    } }))
    await library.undo()
    expect(await readFile(join(root, 'topics/b.md'), 'utf8')).toBe('before B')
    await expect(readFile(join(root, 'topics/a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await library.catalog()).canUndo).toBe(false)
  })

  it('rejects traversal and symlink sources', async () => {
    const { root, path, library } = await setup()
    await expect(readTextSnapshot(root, join(root, '../outside.md'))).rejects.toThrow('允许的目录')
    await symlink(path, join(root, 'linked.md'))
    await expect(readTextSnapshot(root, join(root, 'linked.md'))).rejects.toThrow('符号链接')
    await expect(library.prepare(7, [join(root, 'linked.md')], fakeModel())).rejects.toThrow('原始资料')
    await mkdir(join(root, '.sumi'))
    await writeFile(join(root, '.sumi/knowledge-curation.json'), JSON.stringify({ version: 1, sources: { '资料.md': { hash: 'a'.repeat(64), topics: ['topics/../../outside.md'] } } }))
    await expect(library.catalog()).rejects.toThrow('记录无效')
  })
  it('keeps oversized sources visible without blocking other documents', async () => {
    const { root, path, library } = await setup()
    const large = join(root, 'large.md')
    await writeFile(large, '字'.repeat(400_000))
    const catalog = await library.catalog()
    expect(catalog.documents.find(file => file.path === large)?.unavailableReason).toContain('1 MB')
    await expect(library.prepare(1, [large], fakeModel())).rejects.toThrow('1 MB')
    expect((await library.prepare(1, [path], fakeModel())).files.length).toBe(1)
  })
  it('can read and undo a saved 190,000-character Chinese topic after restart', async () => {
    const { root, path, library } = await setup()
    const draft = await library.prepare(1, [path], fakeModel())
    const content = buildPage({ type: 'concept', title: 'Research' }, '中'.repeat(190_000))
    const [topic] = await library.save(1, { draftId: draft.id, files: [{ id: draft.files[0].id, content }] })
    expect((await new KnowledgeLibrary(root).catalog()).documents.some(file => file.path === topic)).toBe(true)
    await new KnowledgeLibrary(root).undo()
    await expect(readFile(topic)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('Tencent extraction regressions', () => {
  it.each(['', 'plain fragment', '---\ntype: concept\n---\n'])('never substitutes a candidate for an invalid merge (%j)', async result => {
    const old = buildPage({ type: 'concept', title: 'Topic' }, 'old fact')
    const candidate = buildPage({ type: 'concept', title: 'Topic' }, 'new fact')
    await expect(mergePage(old, candidate, { chat: async () => result })).rejects.toThrow('原内容已保留')
  })
  it('merges all chunks that yield the same topic', async () => {
    let generated = 0
    const source = { id: 's1', path: 'source.md', content: 'A'.repeat(27_000) + '\n\n' + 'B'.repeat(27_000) }
    const llm = { chat: vi.fn(async ({ system, prompt, label }: { system: string; prompt: string; label?: string }) => {
      if (system.includes('analyst')) return 'plan'
      if (label === 'merge-rewrite') {
        expect(prompt).toContain('fact 1'); expect(prompt).toContain('fact 2')
        return buildPage({ type: 'concept', title: 'Research' }, 'fact 1 and fact 2')
      }
      return block(`fact ${++generated} [来源](source:s1)`)
    }) }
    const topics = await distillKnowledge([source], [], [source], llm)
    expect(generated).toBeGreaterThan(1)
    expect(topics).toHaveLength(1)
    expect(topics[0].content).toContain('fact 1 and fact 2')
    expect(topics[0].content).toContain('[[source|source]]')
  })
  it('rejects malformed nested and escaping FILE blocks', () => {
    expect(parseFileBlocks('<<<FILE path="wiki/a.md">>>x\n<<<FILE path="wiki/b.md">>>y<<<END>>>').warnings).not.toHaveLength(0)
    expect(parseFileBlocks('<<<FILE path="wiki/../escape.md">>>x<<<END>>>').files).toEqual([])
  })
  it('keeps source references when the topic and original filename have the same title', async () => {
    const source = { id: 's1', path: 'Research.md', content: 'facts' }
    const topics = await distillKnowledge([source], [], [source], { chat: async ({ system }) => system.includes('analyst') ? 'plan' : block('See [[Research]]. [来源](source:s1)') })
    expect(topics[0].content).toContain('See [[topics/concepts/research|Research]]')
    expect(topics[0].content).toContain('- [[Research|Research]]')
  })
  it('merges into the existing target when classification changes', async () => {
    const source = { id: 's1', path: 'source.md', content: 'facts' }
    const previous = { path: 'topics/synthesis/research.md', title: 'Research', content: buildPage({ type: 'synthesis', title: 'Research' }, 'old fact'), sourceIds: [] }
    const llm = { chat: vi.fn(async ({ system, prompt, label }: { system: string; prompt: string; label?: string }) => {
      if (system.includes('analyst')) { expect(prompt).toContain('synthesis'); return 'plan' }
      if (label === 'merge-rewrite') return buildPage({ type: 'concept', title: 'Research' }, 'old fact and new fact')
      return block('new fact [来源](source:s1)')
    }) }
    const topics = await distillKnowledge([source], [previous], [source], llm)
    expect(topics).toHaveLength(1)
    expect(topics[0].path).toBe(previous.path)
    expect(topics[0].content).toContain('old fact and new fact')
  })
})

it('compares drafts inside the editor save queue', async () => {
  const { path } = await setup()
  const old = await readFile(path, 'utf8')
  const editor = atomicWriteTextFile(path, 'new editor content')
  const draft = atomicCompareWriteTextFile(path, old, 'stale generated content')
  await editor
  await expect(draft).rejects.toThrow('已发生变化')
  expect(await readFile(path, 'utf8')).toBe('new editor content')
  await atomicCompareWriteTextFile(path, 'new editor content', null)
  await atomicCompareWriteTextFile(path, null, 'new file')
  expect(await readFile(path, 'utf8')).toBe('new file')
})
