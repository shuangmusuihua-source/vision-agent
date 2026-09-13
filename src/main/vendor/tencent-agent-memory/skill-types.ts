export interface SkillFile {
  frontmatter: {
    name: string
    description: string
    category?: string
    created_at?: string
    updated_at?: string
    source?: 'auto' | 'manual'
    resources?: Array<{ path: string; type: 'text' | 'executable' | 'binary' }>
    [key: string]: unknown
  }
  body: string
  raw: string
}
