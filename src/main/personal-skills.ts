import { mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import type { CurationDraft, CurationSaveRequest, PersonalSkillSummary } from '../shared/curation-types'
import { CurationDrafts } from './curation-jobs'
import { assertCurationPath, readTextSnapshot, replaceSnapshot, type TextSnapshot } from './curation-files'
import { parseSkillFile, validateSkillFile } from './vendor/tencent-agent-memory/skill-format'
import { PERSONAL_SKILL_PROMPT } from './vendor/tencent-agent-memory/skill-prompt'
import type { LlmClient } from './vendor/tencent-agent-memory/llm'
import { runSkillMutation } from './skill-mutation-coordinator'

const MARKER = '.sumi-personal-skill.json'
interface SkillDraft { id: string; snapshot: TextSnapshot; validate: () => void | Promise<void> }

/** SKILL.md is the content authority. The marker distinguishes personal from installed Skills. */
export class PersonalSkills {
  private drafts = new CurationDrafts<SkillDraft>()
  private readonly root: string
  constructor(root: string, private readonly isActive: (id: string) => boolean = () => false) { this.root = resolve(root) }

  private path(id: string): string {
    if (typeof id !== 'string' || !/^personal-[a-z0-9][a-z0-9-]*$/.test(id) || id.length > 64) throw new Error('个人 Skill 名称无效')
    return join(this.root, id, 'SKILL.md')
  }

  private async read(id: string): Promise<TextSnapshot> {
    const path = this.path(id)
    const marker = await readTextSnapshot(this.root, join(this.root, id, MARKER), 1024)
    if (marker.content === null || JSON.parse(marker.content).kind !== 'sumi-personal-skill') throw new Error('只能修改 sumi 保存的个人 Skill')
    const snapshot = await readTextSnapshot(this.root, path)
    if (snapshot.content === null) throw new Error('个人 Skill 文件不存在')
    return snapshot
  }

  async list(enabled: string[] = []): Promise<PersonalSkillSummary[]> {
    let entries
    try { entries = await readdir(this.root, { withFileTypes: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const result: PersonalSkillSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('personal-')) continue
      try {
        const snapshot = await this.read(entry.name)
        const file = parseSkillFile(snapshot.content!)
        validateSkillFile(file)
        if (file.frontmatter.name !== entry.name) continue
        result.push({ id: entry.name, name: file.body.match(/^#\s+(.+)$/m)?.[1] || entry.name,
          description: file.frontmatter.description, updatedAt: (await stat(snapshot.path)).mtimeMs, enabled: enabled.includes(entry.name) })
      } catch { /* Unowned or malformed folders are never exposed as managed personal Skills. */ }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private draft(owner: number, id: string, content: string, snapshot: TextSnapshot, validate: () => void | Promise<void>): CurationDraft {
    const file = parseSkillFile(content)
    validateSkillFile(file)
    if (file.frontmatter.name !== id) throw new Error('Skill 的 name 必须与原名称一致')
    return this.drafts.add(owner, { kind: 'skill', title: snapshot.content === null ? '保存为我的 Skill' : '更新我的 Skill',
      notice: '检查适用场景、步骤和输出要求；保存后可在任务中使用。',
      files: [{ id, title: 'SKILL.md', before: snapshot.content, content }] }, { id, snapshot, validate })
  }

  async prepare(owner: number, input: { transcript: string; artifact?: string; instruction: string; skillId?: string }, llm: LlmClient, validate: () => void | Promise<void>): Promise<CurationDraft> {
    await validate()
    if (typeof input.instruction !== 'string' || input.instruction.length > 4000) throw new Error('请将提炼要求控制在 4000 字以内')
    const existing = input.skillId ? await this.read(input.skillId) : null
    const raw = await llm.chat({ system: PERSONAL_SKILL_PROMPT, prompt: JSON.stringify({
      instruction: input.instruction, updateTarget: input.skillId || null, existingSkill: existing?.content || null,
      pastConversation: input.transcript, selectedArtifact: input.artifact || null,
    }) })
    if (raw.trim() === 'Nothing to save.') throw new Error('这次任务中尚未找到明确的可复用流程，请补充想保留的方法后重试')
    const content = raw.trim()
    const file = parseSkillFile(content)
    validateSkillFile(file)
    const id = input.skillId || file.frontmatter.name
    const path = this.path(id)
    await validate()
    // An existing folder is never silently adopted or overwritten by a new draft.
    if (!existing) {
      try { await stat(join(this.root, id)); throw new Error('同名 Skill 已存在，请选择更新该 Skill 或换一个名称') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await validate()
    return this.draft(owner, id, content, existing || { path, content: null, hash: null }, validate)
  }

  async edit(owner: number, id: string): Promise<CurationDraft> {
    const snapshot = await this.read(id)
    return this.draft(owner, id, snapshot.content!, snapshot, () => {})
  }

  discard(owner: number, id: string): void { this.drafts.discard(owner, id) }
  discardOwner(owner: number): void { this.drafts.discardOwner(owner) }

  async save(owner: number, request: CurationSaveRequest): Promise<string> {
    const { value: draft } = this.drafts.get(owner, request.draftId)
    return runSkillMutation(draft.id, async () => {
      await draft.validate()
      if (this.isActive(draft.id)) throw new Error('该 Skill 正在执行，请等待任务结束后再保存')
      if (!Array.isArray(request.files) || request.files.length !== 1 || request.files[0]?.id !== draft.id
        || typeof request.files[0].content !== 'string') throw new Error('Skill 草稿无效')
      const content = request.files[0].content
      const file = parseSkillFile(content)
      validateSkillFile(file)
      if (file.frontmatter.name !== draft.id) throw new Error('请保留 Skill 的 name；正文和说明可以编辑')
      if (draft.snapshot.content !== null) {
        await this.read(draft.id)
        await draft.validate()
        await replaceSnapshot(this.root, draft.snapshot, content)
      } else {
        await mkdir(this.root, { recursive: true })
        const stage = join(this.root, `.personal-staging-${randomUUID()}`)
        await assertCurationPath(this.root, draft.snapshot.path)
        await mkdir(stage)
        try {
          await writeFile(join(stage, 'SKILL.md'), content, { flag: 'wx' })
          await writeFile(join(stage, MARKER), JSON.stringify({ kind: 'sumi-personal-skill', version: 1 }), { flag: 'wx' })
          await draft.validate()
          // mkdir is exclusive, including when a same-name empty directory appeared during preparation.
          const destination = join(this.root, draft.id)
          await mkdir(destination)
          try { await rename(stage, destination) } catch (error) {
            await rmdir(destination).catch(() => {})
            throw error
          }
        } finally { await rm(stage, { recursive: true, force: true }) }
      }
      this.drafts.discard(owner, request.draftId)
      return draft.id
    })
  }

  async remove(id: string): Promise<void> {
    await runSkillMutation(id, async () => {
      if (this.isActive(id)) throw new Error('该 Skill 正在执行，请等待任务结束后再删除')
      await this.read(id)
      // Retain a hidden recovery copy; discovery ignores dot-prefixed directories.
      await rename(join(this.root, id), join(this.root, `.personal-removed-${id}-${randomUUID()}`))
    })
  }
}
