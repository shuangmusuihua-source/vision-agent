import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PersonalSkills } from '../src/main/personal-skills'
import { parseSkillFile, formatSkillFile } from '../src/main/vendor/tencent-agent-memory/skill-format'

const roots: string[] = []
const content = '---\nname: personal-research\ndescription: 需要竞品调研时使用，生成有来源的研究报告。\nallowed-tools: Read\n---\n\n# 竞品调研\n核对来源，填写比较表。'
async function setup(active = false) {
  const root = await mkdtemp(join(tmpdir(), 'sumi-personal-test-')); roots.push(root)
  return { root, skills: new PersonalSkills(root, () => active) }
}
const input = { transcript: 'past task', instruction: '保留研究方法' }
const llm = { chat: vi.fn(async () => content) }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('personal Skill drafts', () => {
  it('writes only after reviewed save, discovers it, edits it, and removes it from discovery', async () => {
    const { root, skills } = await setup()
    const draft = await skills.prepare(1, input, llm, () => {})
    expect(await readdir(root)).toEqual([])
    const id = await skills.save(1, { draftId: draft.id, files: draft.files })
    expect(await skills.list([id])).toMatchObject([{ id: 'personal-research', name: '竞品调研', enabled: true }])
    const edit = await skills.edit(1, id)
    await skills.save(1, { draftId: edit.id, files: edit.files.map(file => ({ ...file, content: file.content + '\n新增检查' })) })
    expect(await readFile(join(root, id, 'SKILL.md'), 'utf8')).toContain('新增检查')
    await skills.remove(id)
    expect(await skills.list()).toEqual([])
    expect((await readdir(root)).some(name => name.startsWith('.personal-removed-'))).toBe(true)
  })
  it('retains extra supported frontmatter across parse and formatting', () => {
    expect(parseSkillFile(formatSkillFile(parseSkillFile(content))).frontmatter['allowed-tools']).toBe('Read')
  })
  it('rejects foreign owners, active Skills, and changed task scope', async () => {
    const { root, skills } = await setup(true)
    const draft = await skills.prepare(1, input, llm, () => {})
    await expect(skills.save(2, { draftId: draft.id, files: draft.files })).rejects.toThrow('过期')
    await expect(skills.save(1, { draftId: draft.id, files: draft.files })).rejects.toThrow('正在执行')
    const available = new PersonalSkills(root)
    let valid = true
    const next = await available.prepare(1, input, llm, () => { if (!valid) throw new Error('任务已删除') })
    valid = false
    await expect(available.save(1, { draftId: next.id, files: next.files })).rejects.toThrow('任务已删除')
    expect(await readdir(root)).toEqual([])
  })
  it('rejects collisions, external edits, symlinks, and attempts to adopt an unowned Skill', async () => {
    const { root, skills } = await setup()
    await mkdir(join(root, 'personal-existing'))
    await writeFile(join(root, 'personal-existing/SKILL.md'), content)
    await expect(skills.edit(1, 'personal-existing')).rejects.toThrow('只能修改')
    await expect(skills.edit(1, '../builtin')).rejects.toThrow('名称无效')
    const draft = await skills.prepare(1, input, llm, () => {})
    await skills.save(1, { draftId: draft.id, files: draft.files })
    await expect(skills.prepare(1, input, llm, () => {})).rejects.toThrow('同名')
    const edit = await skills.edit(1, 'personal-research')
    const path = join(root, 'personal-research/SKILL.md')
    await writeFile(path, content + '\nmanual change')
    await expect(skills.save(1, { draftId: edit.id, files: edit.files })).rejects.toThrow('已发生变化')
    await rm(path); await symlink(join(root, 'personal-existing/SKILL.md'), path)
    await expect(skills.edit(1, 'personal-research')).rejects.toThrow('符号链接')
  })
  it('uses an explicit update target and never executes storage tools during extraction', async () => {
    const { skills } = await setup()
    const draft = await skills.prepare(1, input, llm, () => {})
    await skills.save(1, { draftId: draft.id, files: draft.files })
    const capture = { chat: vi.fn(async () => content + '\n追加步骤') }
    const update = await skills.prepare(1, { ...input, skillId: 'personal-research' }, capture, () => {})
    expect(update.files[0].before).toBe(content)
    expect(capture.chat.mock.calls[0][0]).toMatchObject({ system: expect.stringContaining('Produce a draft only') })
    expect((await skills.edit(1, 'personal-research')).files[0].content).toBe(content)
  })
  it('refuses empty bodies and absent reusable evidence', async () => {
    const { skills } = await setup()
    await expect(skills.prepare(1, input, { chat: async () => 'Nothing to save.' }, () => {})).rejects.toThrow('可复用流程')
    await expect(skills.prepare(1, input, { chat: async () => '---\nname: personal-empty\ndescription: empty\n---\n' }, () => {})).rejects.toThrow('完整的正文')
  })
})
