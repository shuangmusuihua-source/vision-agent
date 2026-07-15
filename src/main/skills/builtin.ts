export interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
  systemPromptAppend?: string
  outputMode?: 'skill-output' | 'write'
  hideInSlashMenu?: boolean
  defaultEnabled?: boolean
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
    id: 'frontend-slides',
    name: 'frontend-slides',
    description: '创建动画丰富的 HTML 演示文稿，支持 PPT 转换和 34 种风格模板',
    icon: 'PresentationChart',
    promptTemplate: `使用 frontend-slides skill 接下来制作演示文稿... {activeFile}`,
    outputMode: 'write',
  },
  {
    id: 'office-documents',
    name: 'Office 文档',
    description: '无需安装 Microsoft Office，创建、编辑并校验 Word、Excel 和 PowerPoint 文件',
    icon: 'FileSpreadsheet',
    promptTemplate: `使用 office-documents skill 创建或修改可编辑的 Office 文档... {activeFile}`,
    outputMode: 'write',
    defaultEnabled: false,
  },
  {
    id: 'system-cleanup',
    name: '系统清理',
    description: '扫描系统垃圾文件并安全清理，释放磁盘空间',
    icon: 'Trash',
    promptTemplate: `使用 system-cleanup skill 扫描并清理垃圾文件... {activeFile}`,
    hideInSlashMenu: true,
  },
  {
    id: 'organize-desktop',
    name: '整理桌面',
    description: '分析桌面文件分布，按类型或时间智能整理',
    icon: 'Monitor',
    promptTemplate: `使用 organize-desktop skill 整理桌面... {activeFile}`,
    hideInSlashMenu: true,
  },
  {
    id: 'organize-folder',
    name: '整理文件夹',
    description: '分析文件夹内容，按类型分类整理散落文件',
    icon: 'FolderOpen',
    promptTemplate: `使用 organize-folder skill 整理文件夹... {activeFile}`,
    hideInSlashMenu: true,
  },
  {
    id: 'perf-optimize',
    name: '性能优化',
    description: '采集 CPU/内存/磁盘/GPU 数据，分析性能瓶颈，交互式执行优化',
    icon: 'Gauge',
    promptTemplate: `使用 perf-optimize skill 分析并优化系统性能... {activeFile}`,
    hideInSlashMenu: true,
  },
]

export function getBuiltinSkills(): SkillDefinition[] {
  return builtinSkills
}
