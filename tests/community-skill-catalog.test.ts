import { describe, expect, it } from 'vitest'
import { CURATED_COMMUNITY_SKILLS } from '../src/main/skills/community-catalog'

const expectedSources = {
  'frontend-design': ['anthropics/skills', 'skills/frontend-design'],
  'guizang-ppt-skill': ['op7418/guizang-ppt-skill', ''],
  'huashu-design': ['alchaincyf/huashu-design', ''],
  'product-brainstorming': ['anthropics/knowledge-work-plugins', 'product-management/skills/product-brainstorming'],
  'user-research': ['anthropics/knowledge-work-plugins', 'design/skills/user-research'],
  'write-spec': ['anthropics/knowledge-work-plugins', 'product-management/skills/write-spec'],
  pptx: ['anthropics/skills', 'skills/pptx'],
  pdf: ['anthropics/skills', 'skills/pdf'],
  docx: ['anthropics/skills', 'skills/docx'],
  xlsx: ['anthropics/skills', 'skills/xlsx'],
} as const

describe('curated community Skill catalog', () => {
  it('contains the reviewed release catalog with unique ids and pinned sources', () => {
    const ids = CURATED_COMMUNITY_SKILLS.map(skill => skill.id)

    expect(ids).toEqual(Object.keys(expectedSources))
    expect(new Set(ids).size).toBe(ids.length)

    for (const skill of CURATED_COMMUNITY_SKILLS) {
      const [repository, path] = expectedSources[skill.id as keyof typeof expectedSources]
      expect(`${skill.source.owner}/${skill.source.repository}`).toBe(repository)
      expect(skill.source.path).toBe(path)
      expect(skill.source.ref).toMatch(/^[0-9a-f]{40}$/)
      expect(skill.sourcePageUrl).toMatch(/^https:\/\/(www\.skills\.sh|github\.com)\//)
      expect(skill.repositoryUrl).toMatch(/^https:\/\/github\.com\//)
      expect(skill.icon).toBeTruthy()
    }
  })

  it('preserves non-passing audit results instead of presenting them as passed', () => {
    const pdf = CURATED_COMMUNITY_SKILLS.find(skill => skill.id === 'pdf')
    const userResearch = CURATED_COMMUNITY_SKILLS.find(skill => skill.id === 'user-research')

    expect(pdf?.audits).toContainEqual({ name: 'Snyk', status: 'failed' })
    expect(userResearch?.audits).toContainEqual({ name: 'Runlayer', status: 'warning' })
  })
})
