import type { CommunitySkillAudit } from '../../shared/types'

const ANTHROPIC_SKILLS_REF = '35414756ca55738e050562e272a6bbc6273aa926'
const ANTHROPIC_KNOWLEDGE_WORK_REF = '73b2b2dc0cf8467da112d0ef6b555ab022ee219d'
const GUIZANG_PPT_SKILL_REF = '82fe5ae129e8c2a12e1155fcabed6703342749d6'
const HUASHU_DESIGN_REF = '0e7ec8aca0058184c1a9e06e57697e84f68a3f0f'
const AUDIT_PROVIDERS = ['Gen Agent Trust Hub', 'Socket', 'Snyk', 'Runlayer', 'ZeroLeaks'] as const

function audits(overrides: Partial<Record<(typeof AUDIT_PROVIDERS)[number], CommunitySkillAudit['status']>> = {}): CommunitySkillAudit[] {
  return AUDIT_PROVIDERS.map(name => ({ name, status: overrides[name] || 'passed' }))
}

function sumiReviewed(): CommunitySkillAudit[] {
  return [{ name: 'sumi 精选复核', status: 'reviewed' }]
}

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
  installLimits?: {
    maxFileCount?: number
    maxFileSize?: number
    maxTotalSize?: number
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
    icon: 'Palette',
    audits: [
      { name: 'Gen Agent Trust Hub', status: 'passed' },
      { name: 'Socket', status: 'passed' },
      { name: 'Snyk', status: 'passed' },
    ],
    promptTemplate: '基于当前任务设计并实现前端界面。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/frontend-design',
      ref: ANTHROPIC_SKILLS_REF,
    },
  },
  {
    id: 'guizang-ppt-skill',
    name: 'guizang-ppt-skill',
    author: '歸藏',
    category: '文档与交付',
    summary: '生成电子杂志风和瑞士国际主义风格的横向翻页网页 PPT',
    description: '面向分享、演讲和发布会场景的 HTML 演示文稿 Skill，提供电子杂志、电子墨水和瑞士国际主义两套视觉体系，包含模板、布局、主题、截图适配和质量检查流程。',
    tags: ['网页 PPT', '演示文稿', '电子杂志', '瑞士风'],
    sourcePageUrl: 'https://github.com/op7418/guizang-ppt-skill',
    repositoryUrl: 'https://github.com/op7418/guizang-ppt-skill',
    icon: 'Presentation',
    audits: sumiReviewed(),
    promptTemplate: '使用 guizang-ppt-skill skill 接下来制作 PPT... {activeFile}',
    source: {
      owner: 'op7418',
      repository: 'guizang-ppt-skill',
      path: '',
      ref: GUIZANG_PPT_SKILL_REF,
    },
  },
  {
    id: 'huashu-design',
    name: '花叔设计',
    author: '花叔',
    category: '设计与界面',
    summary: '用 HTML 做高保真原型、交互 Demo、幻灯片、动画和设计评审',
    description: '面向视觉产出和设计探索的综合 Skill，覆盖高保真原型、设计变体、HTML 演示、动画 Demo、信息图、导出视频以及专家评审，强调从真实上下文出发并避免模板化 AI 视觉。',
    tags: ['高保真原型', 'HTML 演示', '动画', '设计评审'],
    sourcePageUrl: 'https://github.com/alchaincyf/huashu-design',
    repositoryUrl: 'https://github.com/alchaincyf/huashu-design',
    icon: 'WandSparkles',
    audits: sumiReviewed(),
    promptTemplate: '使用 huashu-design skill 制作 {activeFile}',
    source: {
      owner: 'alchaincyf',
      repository: 'huashu-design',
      path: '',
      ref: HUASHU_DESIGN_REF,
    },
    installLimits: {
      maxFileCount: 220,
      maxFileSize: 6 * 1024 * 1024,
      maxTotalSize: 40 * 1024 * 1024,
    },
  },
  {
    id: 'product-brainstorming',
    name: 'Product Brainstorming',
    author: 'Anthropic',
    category: '产品与研究',
    summary: '探索产品问题、生成方案并挑战关键假设',
    description: '作为有判断力的产品思考伙伴，帮助产品经理探索问题空间、发散解决方向、检验假设，并在形成规格前把关键问题想清楚。',
    tags: ['产品构思', '问题探索', '方案发散'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/knowledge-work-plugins/product-brainstorming',
    repositoryUrl: 'https://github.com/anthropics/knowledge-work-plugins',
    icon: 'Lightbulb',
    audits: audits(),
    promptTemplate: '围绕当前产品问题开展结构化头脑风暴，挑战关键假设并形成可选方向。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'knowledge-work-plugins',
      path: 'product-management/skills/product-brainstorming',
      ref: ANTHROPIC_KNOWLEDGE_WORK_REF,
    },
  },
  {
    id: 'user-research',
    name: 'User Research',
    author: 'Anthropic',
    category: '产品与研究',
    summary: '规划访谈、可用性测试、问卷与研究分析',
    description: '帮助规划、执行和综合用户研究，覆盖研究问题、访谈提纲、可用性测试、问卷设计和研究结果整理。',
    tags: ['用户研究', '访谈', '可用性测试'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/knowledge-work-plugins/user-research',
    repositoryUrl: 'https://github.com/anthropics/knowledge-work-plugins',
    icon: 'Search',
    audits: audits({ Runlayer: 'warning' }),
    promptTemplate: '围绕当前任务规划或综合用户研究，给出清晰的方法、问题与分析框架。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'knowledge-work-plugins',
      path: 'design/skills/user-research',
      ref: ANTHROPIC_KNOWLEDGE_WORK_REF,
    },
  },
  {
    id: 'write-spec',
    name: 'Write Spec',
    author: 'Anthropic',
    category: '产品与研究',
    summary: '把产品想法整理成清晰可执行的功能规格或 PRD',
    description: '从问题陈述或功能想法出发，梳理目标、非目标、用户故事、成功指标、验收标准和分阶段范围，形成结构化产品规格。',
    tags: ['PRD', '功能规格', '需求规划'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/knowledge-work-plugins/write-spec',
    repositoryUrl: 'https://github.com/anthropics/knowledge-work-plugins',
    icon: 'ClipboardList',
    audits: audits(),
    promptTemplate: '基于当前对话和资料撰写功能规格或 PRD，明确范围、指标与验收标准。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'knowledge-work-plugins',
      path: 'product-management/skills/write-spec',
      ref: ANTHROPIC_KNOWLEDGE_WORK_REF,
    },
  },
  {
    id: 'pptx',
    name: 'PowerPoint (PPTX)',
    author: 'Anthropic',
    category: '文档与交付',
    summary: '创建、读取和编辑 PowerPoint 演示文稿',
    description: '覆盖演示文稿读取、模板编辑、从零创建和视觉质量检查；部分流程可能调用 MarkItDown、LibreOffice 或 Node/Python 工具。',
    tags: ['PowerPoint', '演示文稿', '幻灯片'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/skills/pptx',
    repositoryUrl: 'https://github.com/anthropics/skills',
    icon: 'Presentation',
    audits: audits(),
    promptTemplate: '根据当前任务创建、读取或编辑 PowerPoint 演示文稿，并完成必要的质量检查。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/pptx',
      ref: ANTHROPIC_SKILLS_REF,
    },
  },
  {
    id: 'pdf',
    name: 'PDF',
    author: 'Anthropic',
    category: '文档与交付',
    summary: '提取、合并、拆分、OCR 和生成 PDF',
    description: '提供 PDF 文本与表格提取、合并拆分、旋转、水印、表单和 OCR 等工作流；部分操作依赖 Python 库或系统命令行工具。',
    tags: ['PDF', 'OCR', '文档处理'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/skills/pdf',
    repositoryUrl: 'https://github.com/anthropics/skills',
    icon: 'FileText',
    audits: audits({ Snyk: 'failed' }),
    promptTemplate: '根据当前任务读取、分析、编辑或生成 PDF，并保留必要的结构与格式。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/pdf',
      ref: ANTHROPIC_SKILLS_REF,
    },
  },
  {
    id: 'docx',
    name: 'Word (DOCX)',
    author: 'Anthropic',
    category: '文档与交付',
    summary: '创建、读取和编辑专业 Word 文档',
    description: '支持 Word 文档读取、创建、格式化和 XML 级编辑，可处理表格、图片、目录、页眉页脚、批注与修订；部分流程依赖 Pandoc 或 Node 工具。',
    tags: ['Word', 'DOCX', '专业文档'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/skills/docx',
    repositoryUrl: 'https://github.com/anthropics/skills',
    icon: 'FileText',
    audits: audits(),
    promptTemplate: '根据当前任务创建、读取或编辑 Word 文档，并检查内容结构与排版质量。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/docx',
      ref: ANTHROPIC_SKILLS_REF,
    },
  },
  {
    id: 'xlsx',
    name: 'Excel (XLSX)',
    author: 'Anthropic',
    category: '文档与交付',
    summary: '分析、创建和编辑带公式与格式的电子表格',
    description: '支持 Excel、CSV 和 TSV 的分析与编辑，涵盖公式、格式、图表和错误检查；完整计算与渲染可能依赖 pandas、openpyxl 和 LibreOffice。',
    tags: ['Excel', '数据分析', '电子表格'],
    sourcePageUrl: 'https://www.skills.sh/anthropics/skills/xlsx',
    repositoryUrl: 'https://github.com/anthropics/skills',
    icon: 'FileSpreadsheet',
    audits: audits(),
    promptTemplate: '根据当前任务分析、创建或编辑电子表格，保留公式和格式并检查计算错误。{activeFile}',
    source: {
      owner: 'anthropics',
      repository: 'skills',
      path: 'skills/xlsx',
      ref: ANTHROPIC_SKILLS_REF,
    },
  },
]

export function getCuratedCommunitySkill(skillId: string): CuratedCommunitySkill | undefined {
  return CURATED_COMMUNITY_SKILLS.find(skill => skill.id === skillId)
}
