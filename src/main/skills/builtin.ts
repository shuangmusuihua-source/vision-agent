export interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
  systemPromptAppend?: string
  outputMode?: 'skill-output' | 'write'
}

const builtinSkills: SkillDefinition[] = [
  {
    id: 'kami',
    name: 'Kami · 紙',
    description: '排版专业文档和产品落地页：简历、一页纸、白皮书、作品集、PPT、落地页',
    icon: 'FileText',
    promptTemplate: `使用 kami skill 接下来排版... {activeFile}`,
    outputMode: 'write',
  },
  {
    id: 'guizang-ppt-skill',
    name: 'guizang-ppt-skill',
    description: '生成横向翻页网页 PPT：电子杂志风 / 瑞士国际主义风',
    icon: 'PresentationChart',
    promptTemplate: `使用 guizang-ppt-skill skill 接下来制作 PPT... {activeFile}`,
    outputMode: 'write',
  },
  {
    id: 'frontend-slides',
    name: 'frontend-slides',
    description: '创建动画丰富的 HTML 演示文稿，支持 PPT 转换和 34 种风格模板',
    icon: 'PresentationChart',
    promptTemplate: `使用 frontend-slides skill 接下来制作演示文稿... {activeFile}`,
    outputMode: 'write',
  },
]

export function getBuiltinSkills(): SkillDefinition[] {
  return builtinSkills
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return builtinSkills.find((s) => s.id === id)
}
