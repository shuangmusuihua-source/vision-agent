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
]

export function getBuiltinSkills(): SkillDefinition[] {
  return builtinSkills
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return builtinSkills.find((s) => s.id === id)
}
