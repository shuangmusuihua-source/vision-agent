import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SKILLS } from '../src/main/skills/skills-manifest'

const skillsRoot = join(process.cwd(), 'src', 'main', 'skills')

describe('built-in skill manifest', () => {
  it('references complete source directories', async () => {
    for (const skill of BUILTIN_SKILLS.filter(item => item.hasResources)) {
      for (const requiredPath of skill.requiredPaths) {
        await expect(access(join(skillsRoot, skill.id, requiredPath))).resolves.toBeUndefined()
      }
    }
  })

  it('pins third-party sources to immutable commits', () => {
    const sourcedSkills = BUILTIN_SKILLS.filter(item => item.source)

    expect(sourcedSkills.map(item => item.id)).toEqual([
      'kami',
      'frontend-slides',
    ])
    for (const skill of sourcedSkills) {
      expect(skill.source?.repositoryUrl).toMatch(/^https:\/\/github\.com\//)
      expect(skill.source?.ref).toMatch(/^[0-9a-f]{40}$/)
      expect(skill.source?.license).toBe('MIT')
    }
  })

  it('keeps the bundled Kami version aligned with its manifest', async () => {
    const kami = BUILTIN_SKILLS.find(item => item.id === 'kami')
    const version = (await readFile(join(skillsRoot, 'kami', 'VERSION'), 'utf8')).trim()

    expect(kami?.version).toBe('1.9.0')
    expect(version).toBe(kami?.version)
  })

  it('does not bundle Kami repository-only material', async () => {
    const excludedPaths = [
      'README.md',
      'dist',
      'assets/demos',
      'assets/showcase',
      '.github',
    ]

    for (const path of excludedPaths) {
      await expect(access(join(skillsRoot, 'kami', path))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
