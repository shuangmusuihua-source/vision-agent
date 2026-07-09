import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installCommunitySkill,
  inspectCommunitySkillInstallation,
  uninstallCommunitySkill,
} from '../src/main/community-skill-installer'
import type { CuratedCommunitySkill } from '../src/main/skills/community-catalog'

const tempDirs: string[] = []

const skill: CuratedCommunitySkill = {
  id: 'frontend-design',
  name: 'Frontend Design',
  author: 'Anthropic',
  category: '设计与界面',
  summary: 'summary',
  description: 'description',
  tags: [],
  sourcePageUrl: 'https://www.skills.sh/anthropics/skills/frontend-design',
  repositoryUrl: 'https://github.com/anthropics/skills',
  audits: [],
  promptTemplate: 'use it',
  icon: 'Palette',
  source: {
    owner: 'anthropics',
    repository: 'skills',
    path: 'skills/frontend-design',
    ref: 'main',
  },
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-community-skill-test-'))
  tempDirs.push(dir)
  return dir
}

function createFetcher(options?: { unsupportedEntry?: boolean }): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/git/trees/')) {
      return new Response(JSON.stringify({
        truncated: false,
        tree: [
          { path: 'skills/frontend-design', type: 'tree', mode: '040000' },
          {
            path: 'skills/frontend-design/SKILL.md',
            type: 'blob',
            mode: '100644',
            size: 8,
          },
          { path: 'skills/frontend-design/assets', type: 'tree', mode: '040000' },
          {
            path: 'skills/frontend-design/assets/guide.txt',
            type: 'blob',
            mode: options?.unsupportedEntry ? '120000' : '100644',
            size: 5,
          },
        ],
      }), { status: 200 })
    }
    if (url.endsWith('/SKILL.md')) {
      return new Response('---\nname: frontend-design\ndescription: Design frontend interfaces\n---\n\n# Skill\n', { status: 200 })
    }
    if (url.endsWith('/guide.txt')) return new Response('guide', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

function createTruncatedTreeFetcher(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes('/git/trees/')) {
      return new Response(JSON.stringify({
        truncated: true,
        tree: [
          { path: 'skills/frontend-design', type: 'tree', mode: '040000' },
        ],
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

function createRootSkillFetcher(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/git/trees/')) {
      return new Response(JSON.stringify({
        truncated: false,
        tree: [
          { path: 'SKILL.md', type: 'blob', mode: '100644', size: 8 },
          { path: 'assets', type: 'tree', mode: '040000' },
          { path: 'assets/template.html', type: 'blob', mode: '100644', size: 9 },
        ],
      }), { status: 200 })
    }
    if (url.endsWith('/SKILL.md')) {
      return new Response('---\nname: frontend-design\ndescription: Design frontend interfaces\n---\n\n# Skill\n', { status: 200 })
    }
    if (url.endsWith('/template.html')) return new Response('<main />', { status: 200 })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

function createLargeSkillFetcher(): typeof fetch {
  const largeContent = 'x'.repeat(3 * 1024 * 1024)
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/git/trees/')) {
      return new Response(JSON.stringify({
        truncated: false,
        tree: [
          { path: 'skills/frontend-design', type: 'tree', mode: '040000' },
          { path: 'skills/frontend-design/SKILL.md', type: 'blob', mode: '100644', size: 72 },
          { path: 'skills/frontend-design/assets/large.bin', type: 'blob', mode: '100644', size: largeContent.length },
        ],
      }), { status: 200 })
    }
    if (url.endsWith('/SKILL.md')) {
      return new Response('---\nname: frontend-design\ndescription: Design frontend interfaces\n---\n\n# Skill\n', { status: 200 })
    }
    if (url.endsWith('/large.bin')) return new Response(largeContent, { status: 200 })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('community Skill installer', () => {
  it('downloads a reviewed Skill recursively and records sumi ownership', async () => {
    const targetRoot = await createTempDir()

    await installCommunitySkill({ targetRoot, skill, fetcher: createFetcher() })

    expect(await readFile(join(targetRoot, skill.id, 'SKILL.md'), 'utf8')).toContain('name: frontend-design')
    expect(await readFile(join(targetRoot, skill.id, 'assets', 'guide.txt'), 'utf8')).toBe('guide')
    expect(await inspectCommunitySkillInstallation(targetRoot, skill.id)).toMatchObject({
      installedAt: expect.any(String),
      sourceRef: 'main',
    })
  })

  it('downloads a reviewed Skill from a repository root', async () => {
    const targetRoot = await createTempDir()

    await installCommunitySkill({
      targetRoot,
      skill: { ...skill, source: { ...skill.source, path: '' } },
      fetcher: createRootSkillFetcher(),
    })

    expect(await readFile(join(targetRoot, skill.id, 'SKILL.md'), 'utf8')).toContain('name: frontend-design')
    expect(await readFile(join(targetRoot, skill.id, 'assets', 'template.html'), 'utf8')).toBe('<main />')
  })

  it('allows reviewed catalog entries to declare tighter scoped install limits', async () => {
    const targetRoot = await createTempDir()

    await expect(installCommunitySkill({ targetRoot, skill, fetcher: createLargeSkillFetcher() }))
      .rejects.toThrow('文件过大')

    await installCommunitySkill({
      targetRoot,
      skill: {
        ...skill,
        installLimits: {
          maxFileSize: 4 * 1024 * 1024,
          maxTotalSize: 5 * 1024 * 1024,
        },
      },
      fetcher: createLargeSkillFetcher(),
    })

    expect(await inspectCommunitySkillInstallation(targetRoot, skill.id)).toMatchObject({
      sourceRef: 'main',
    })
  })

  it('preserves the original install time and records the new source ref on update', async () => {
    const targetRoot = await createTempDir()
    await installCommunitySkill({ targetRoot, skill, fetcher: createFetcher() })
    const firstInstallation = await inspectCommunitySkillInstallation(targetRoot, skill.id)

    await installCommunitySkill({
      targetRoot,
      skill: { ...skill, source: { ...skill.source, ref: 'next-release' } },
      fetcher: createFetcher(),
    })

    expect(await inspectCommunitySkillInstallation(targetRoot, skill.id)).toEqual({
      installedAt: firstInstallation?.installedAt,
      updatedAt: expect.any(String),
      sourceRef: 'next-release',
    })
  })

  it('rejects symbolic links and other unsupported repository entries', async () => {
    const targetRoot = await createTempDir()

    await expect(installCommunitySkill({ targetRoot, skill, fetcher: createFetcher({ unsupportedEntry: true }) }))
      .rejects.toThrow('不支持的资源')
    await expect(lstat(join(targetRoot, skill.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a truncated GitHub file tree', async () => {
    const targetRoot = await createTempDir()

    await expect(installCommunitySkill({ targetRoot, skill, fetcher: createTruncatedTreeFetcher() }))
      .rejects.toThrow('文件树不完整')
    await expect(lstat(join(targetRoot, skill.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an unmanaged Skill with the same id', async () => {
    const targetRoot = await createTempDir()
    await mkdir(join(targetRoot, skill.id), { recursive: true })
    await writeFile(join(targetRoot, skill.id, 'SKILL.md'), '# user skill\n', 'utf8')

    await expect(installCommunitySkill({ targetRoot, skill, fetcher: createFetcher() }))
      .rejects.toThrow('不是由 sumi 安装')
    expect(await readFile(join(targetRoot, skill.id, 'SKILL.md'), 'utf8')).toBe('# user skill\n')
  })

  it('rejects a downloaded Skill whose declared name differs from the catalog', async () => {
    const targetRoot = await createTempDir()
    const fetcher = createFetcher()
    const mismatchedFetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/SKILL.md')) {
        return new Response('---\nname: another-skill\ndescription: Wrong package\n---\n', { status: 200 })
      }
      return fetcher(input)
    }) as unknown as typeof fetch

    await expect(installCommunitySkill({ targetRoot, skill, fetcher: mismatchedFetcher }))
      .rejects.toThrow('Skill 名称与精选目录不一致')
    await expect(lstat(join(targetRoot, skill.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uninstalls only a Skill carrying the sumi ownership marker', async () => {
    const targetRoot = await createTempDir()
    await installCommunitySkill({ targetRoot, skill, fetcher: createFetcher() })

    await uninstallCommunitySkill(targetRoot, skill.id)

    await expect(lstat(join(targetRoot, skill.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
