export interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
}

const builtinSkills: SkillDefinition[] = [
  {
    id: 'prd-generator',
    name: 'PRD 生成器',
    description: '基于结构化 md 生成产品需求文档',
    icon: 'FileText',
    promptTemplate: `你是一个专业的产品经理。请阅读以下文件的内容，并基于它生成一份完整的产品需求文档（PRD）。

文件路径：{activeFile}

要求：
1. 按照标准 PRD 模板结构化输出：背景与目标、用户场景、功能需求、非功能需求、技术方案建议、里程碑规划
2. 如果原文信息不足，合理补充并标注"【待确认】"
3. 将 PRD 写入与原文件同目录下的 prd-生成.md 文件中
4. 输出完成后，告知用户文件路径`
  },
  {
    id: 'ppt-generator',
    name: 'PPT 生成器',
    description: '基于 md 生成 PPT 大纲',
    icon: 'PresentationChart',
    promptTemplate: `你是一个专业的演示文稿设计师。请阅读以下文件的内容，并基于它生成一份 PPT 大纲。

文件路径：{activeFile}

要求：
1. 按照 PPT 结构输出：标题页、目录页、内容页（每页有标题和要点）、总结页
2. 每页内容精炼，要点不超过 5 条
3. 总页数控制在 10-15 页
4. 将 PPT 大纲写入与原文件同目录下的 ppt-生成.md 文件中
5. 输出完成后，告知用户文件路径`
  },
  {
    id: 'summary',
    name: '内容摘要',
    description: '生成 md 的精简摘要',
    icon: 'Article',
    promptTemplate: `请阅读以下文件的内容，并生成一份精简摘要。

文件路径：{activeFile}

要求：
1. 提取核心观点和关键信息
2. 保留重要的数据和结论
3. 摘要长度为原文的 20%-30%
4. 将摘要写入与原文件同目录下的 摘要.md 文件中
5. 输出完成后，告知用户文件路径`
  },
  {
    id: 'slides',
    name: 'Slides',
    description: '创建精美的 HTML 演示文稿，支持动画和 PPTX 导出',
    icon: 'PresentationChart',
    promptTemplate: `你是一个专业的演示文稿设计师。请使用 slides skill 创建一份精美的 HTML 演示文稿。

请先阅读 .claude/skills/slides/SKILL.md 了解工作流程，阅读 .claude/skills/slides/STYLE_PRESETS.md 选择风格预设，阅读 .claude/skills/slides/TEMPLATES.md 获取 HTML 模板。

用户需求：{activeFile}

要求：
1. 生成一个自包含的 HTML 文件，所有 CSS 和 JS 内联
2. 每页幻灯片适配一个视口，不允许内部滚动
3. 包含键盘导航（方向键、空格键）和进度指示器
4. 使用 CSS 动画实现入场效果
5. 支持 prefers-reduced-motion
6. 将 HTML 文件保存到工作区目录
7. 完成后告知用户文件路径，可用浏览器打开预览`
  }
]

export function getBuiltinSkills(): SkillDefinition[] {
  return builtinSkills
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return builtinSkills.find((s) => s.id === id)
}
