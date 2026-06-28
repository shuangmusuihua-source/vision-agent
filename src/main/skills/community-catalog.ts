import type { CommunitySkillAudit } from '../../shared/types'

export interface CuratedCommunitySkill {
  id: string
  name: string
  author: string
  category: string
  summary: string
  description: string
  tags: string[]
  sourcePageUrl: string
  repositoryUrl: string
  audits: CommunitySkillAudit[]
  promptTemplate: string
  icon: string
  source: {
    owner: string
    repository: string
    path: string
    ref: string
  }
}

/**
 * Release-managed catalog. Entries are reviewed and added here before release;
 * the app never scrapes the listing page at runtime.
 */
export const CURATED_COMMUNITY_SKILLS: readonly CuratedCommunitySkill[] = [
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    author: 'Anthropic',
    category: '设计与界面',
    summary: '创建有辨识度、可直接交付的前端界面',
    description: '面向网页、组件和应用界面的设计与实现，强调清晰的视觉方向、完整交互和生产级代码，避免模板化的通用界面。',
    tags: ['前端设计', '界面实现', '视觉系统'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/skills/frontend-design',
    repositoryUrl: 'https://github.com/anthropics/skills',
    audits: [
      { name: 'Gen Agent Trust Hub', status: 'passed' },
      { name: 'Socket', status: 'passed' },
      { name: 'Snyk', status: 'passed' },
    ],
    promptTemplate: '基于当前任务设计并实现前端界面。{activeFile}',
    icon: 'Palette',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/frontend-design',
      ref: '35414756ca55738e050562e272a6bbc6273aa926',
    },
  },
]

export function getCuratedCommunitySkill(skillId: string): CuratedCommunitySkill | undefined {
  return CURATED_COMMUNITY_SKILLS.find(skill => skill.id === skillId)
}
