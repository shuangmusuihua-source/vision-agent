import { dirname, posix } from 'path'
import { chunkText } from './vendor/tencent-agent-memory/chunker'
import { parseFileBlocks } from './vendor/tencent-agent-memory/file-protocol'
import { buildPage, parseFrontmatter } from './vendor/tencent-agent-memory/frontmatter'
import { mergePage } from './vendor/tencent-agent-memory/merge'
import { slugify, dirForType } from './vendor/tencent-agent-memory/slug'
import { buildAnalysisPrompt, buildAnalysisSystemPrompt, buildGenerateFromAnalysisPrompt, buildSystemPrompt } from './vendor/tencent-agent-memory/prompts'
import { PERSONAL_WIKI_TEMPLATE } from './vendor/tencent-agent-memory/template'
import type { LlmClient } from './vendor/tencent-agent-memory/llm'

export interface KnowledgeSource { id: string; path: string; content: string }
export interface TopicCandidate { path: string; title: string; content: string; sourceIds: string[] }

/** Tencent's extract/merge split, with every chunk retained before committing any file. */
export async function distillKnowledge(
  sources: KnowledgeSource[], existing: TopicCandidate[], allSources: KnowledgeSource[], llm: LlmClient,
): Promise<TopicCandidate[]> {
  const existingInfo = existing.map(page => ({ relPath: page.path.replace(/^topics\//, 'wiki/'), title: page.title, type: parseFrontmatter(page.content).frontmatter.type || 'concept' }))
  const before = new Map(existing.map(page => [page.path, page.content]))
  const candidates = new Map<string, TopicCandidate>()
  const allowedSources = new Map(allSources.map(source => [source.id, source.path]))
  for (const source of sources) {
    for (const chunk of chunkText(source.content, { targetChars: 28_000 })) {
      const sourceName = `${source.id}（${source.path}）`
      const analysis = await llm.chat({
        system: buildAnalysisSystemPrompt(PERSONAL_WIKI_TEMPLATE),
        prompt: buildAnalysisPrompt({ sourceName, sourceText: chunk, existingPages: existingInfo }),
      })
      const generated = await llm.chat({
        system: buildSystemPrompt(PERSONAL_WIKI_TEMPLATE),
        prompt: buildGenerateFromAnalysisPrompt({ sourceName, sourceText: chunk, analysis, existingPages: existingInfo }),
      })
      const parsed = parseFileBlocks(generated)
      // A truncated/invalid response is not a successful partial import.
      if (!parsed.files.length || parsed.warnings.length) throw new Error('生成的主题不完整，请重试；已有知识未修改')
      for (const file of parsed.files) {
        const page = parseFrontmatter(file.content)
        const title = typeof page.frontmatter.title === 'string' ? page.frontmatter.title.trim() : ''
        if (!page.hasFrontmatter || !title || !page.body.trim()) throw new Error('主题缺少标题或正文，请重试')
        const slug = slugify(title)
        if (!slug || slug.length > 100) throw new Error('生成的主题名称无效')
        // Reuse an app-known target even if the model changes its classification or filename.
        const known = [...existing, ...candidates.values()]
        const requestedPath = file.path.replace(/^wiki\//, 'topics/')
        const targetPage = known.find(item => item.path === requestedPath)
          || known.find(item => item.title === title)
        const path = targetPage?.path || `topics/${dirForType(page.frontmatter.type)}/${slug}.md`
        if (!new RegExp(`\\]\\(source:${source.id}\\)`).test(page.body)) throw new Error('主题缺少可追溯来源，请重试')
        const body = page.body.replace(/\]\(source:([^\s)]+)\)/g, (_whole, id: string) => {
          const target = allowedSources.get(id)
          if (!target) throw new Error('主题包含未知来源，未保存')
          const url = posix.relative(dirname(path), target).split('/').map(encodeURIComponent).join('/')
          return `](${url})`
        })
        const candidateContent = buildPage({ ...page.frontmatter, sources: [source.id] }, body)
        const previous = candidates.get(path)?.content ?? before.get(path) ?? null
        const decision = await mergePage(previous, candidateContent, llm)
        if (decision.action === 'skip') throw new Error(`“${title}”已锁定，请先解锁或选择其他资料`)
        if (decision.content.length > 200_000) throw new Error('单个主题过长，请缩小整理范围')
        const merged = parseFrontmatter(decision.content)
        const sourceIds = (Array.isArray(merged.frontmatter.sources) ? merged.frontmatter.sources : [])
          .filter((id): id is string => typeof id === 'string')
        // Keep an application-owned source list even if a model drops an inline citation during merging.
        const references = sourceIds.map(id => {
          const target = allowedSources.get(id)
          if (!target) return `- 来源已移出知识库：${id.replace(/[\r\n<>]/g, '')}`
          const url = posix.relative(dirname(path), target).split('/').map(encodeURIComponent).join('/')
          // Use the same wikilink format as the existing knowledge graph for source edges.
          if (!/[\[\]|#]/.test(target)) return `- [[${target.slice(0, -3)}|${target.slice(0, -3)}]]`
          return `- [${target.replace(/[\[\]]/g, '')}](${url})`
        }).join('\n')
        const withoutReferences = merged.body.replace(/\n<!-- sumi:sources -->[\s\S]*?<!-- \/sumi:sources -->/g, '')
        const content = buildPage({ ...merged.frontmatter, title, sources: sourceIds }, `${withoutReferences}\n\n<!-- sumi:sources -->\n### 参考资料\n${references}\n<!-- /sumi:sources -->`)
        candidates.set(path, { path, title, content, sourceIds })
        const info = { relPath: path.replace(/^topics\//, 'wiki/'), title, type: page.frontmatter.type }
        const infoIndex = existingInfo.findIndex(item => item.relPath === info.relPath)
        if (infoIndex < 0) existingInfo.push(info)
        else existingInfo[infoIndex] = info
        if (candidates.size > 24) throw new Error('生成主题过多，请缩小整理范围')
      }
    }
  }
  // Resolve generated title links to filenames compatible with sumi's existing wikilink graph.
  const titles = new Map([...existing, ...candidates.values()].map(page => [page.title, page.path.slice(0, -3)]))
  return [...candidates.values()].map(page => ({ ...page, content: page.content.replace(/<!-- sumi:sources -->[\s\S]*?<!-- \/sumi:sources -->|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (whole, target?: string, label?: string) => target && titles.has(target.trim()) ? `[[${titles.get(target.trim())}|${label || target.trim()}]]` : whole) }))
}
