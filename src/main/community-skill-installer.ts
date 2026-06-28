import { randomUUID } from 'crypto'
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { load as parseYaml } from 'js-yaml'
import type { CuratedCommunitySkill } from './skills/community-catalog'

const METADATA_FILE = '.sumi-community-skill.json'
const MAX_FILE_COUNT = 128
const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_TOTAL_SIZE = 8 * 1024 * 1024

interface CommunitySkillMetadata {
  schemaVersion: 1
  managedBy: 'sumi'
  id: string
  sourcePageUrl: string
  repositoryUrl: string
  sourceRef?: string
  installedAt: string
  updatedAt?: string
}

interface GitHubContentEntry {
  name: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  size?: number
  download_url?: string | null
}

export interface CommunitySkillInstallation {
  installedAt: string
  updatedAt?: string
  sourceRef: string
}

export interface CommunitySkillInstallerOptions {
  targetRoot: string
  skill: CuratedCommunitySkill
  fetcher?: typeof fetch
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value === '.' || value === '..' || value.includes('\0') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

function encodeRepositoryPath(value: string): string {
  const segments = value.split('/')
  if (segments.length === 0) throw new Error('Skill source path is empty')
  for (const segment of segments) assertSafeSegment(segment, 'repository path')
  return segments.map(encodeURIComponent).join('/')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readManagedMetadata(targetDir: string, expectedId: string): Promise<CommunitySkillMetadata | null> {
  try {
    const targetStat = await lstat(targetDir)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) return null
    const parsed = JSON.parse(await readFile(join(targetDir, METADATA_FILE), 'utf8')) as Partial<CommunitySkillMetadata>
    if (
      parsed.schemaVersion !== 1
      || parsed.managedBy !== 'sumi'
      || parsed.id !== expectedId
      || typeof parsed.installedAt !== 'string'
    ) return null
    const skillFile = await stat(join(targetDir, 'SKILL.md'))
    if (!skillFile.isFile()) return null
    return parsed as CommunitySkillMetadata
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sumi-desktop',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`下载源返回 ${response.status}，请稍后重试`)
  }
  return response.json()
}

async function downloadFile(fetcher: typeof fetch, url: string): Promise<Buffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com') {
    throw new Error('Skill 文件来源不受信任')
  }
  const response = await fetcher(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`下载 Skill 文件失败 (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

async function downloadDirectory(
  options: CommunitySkillInstallerOptions,
  stagingDir: string,
): Promise<void> {
  const fetcher = options.fetcher || fetch
  const { owner, repository, path: sourcePath, ref } = options.skill.source
  let fileCount = 0
  let totalSize = 0

  assertSafeSegment(owner, 'repository owner')
  assertSafeSegment(repository, 'repository name')

  const visit = async (repositoryPath: string, relativeSegments: string[]): Promise<void> => {
    const endpoint = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodeRepositoryPath(repositoryPath)}`)
    endpoint.searchParams.set('ref', ref)
    const payload = await fetchJson(fetcher, endpoint.toString())
    if (!Array.isArray(payload)) throw new Error('Skill 下载源不是目录')

    for (const rawEntry of payload) {
      if (!rawEntry || typeof rawEntry !== 'object') throw new Error('Skill 下载源数据无效')
      const entry = rawEntry as GitHubContentEntry
      assertSafeSegment(entry.name, 'Skill file name')
      const nextRelative = [...relativeSegments, entry.name]
      const nextRepositoryPath = `${repositoryPath}/${entry.name}`

      if (entry.type === 'dir') {
        await visit(nextRepositoryPath, nextRelative)
        continue
      }
      if (entry.type !== 'file' || !entry.download_url) {
        throw new Error(`Skill 包含不支持的资源: ${entry.name}`)
      }

      fileCount += 1
      if (fileCount > MAX_FILE_COUNT) throw new Error('Skill 文件数量超过安全限制')
      if ((entry.size || 0) > MAX_FILE_SIZE) throw new Error(`Skill 文件过大: ${entry.name}`)

      const content = await downloadFile(fetcher, entry.download_url)
      if (content.byteLength > MAX_FILE_SIZE) throw new Error(`Skill 文件过大: ${entry.name}`)
      totalSize += content.byteLength
      if (totalSize > MAX_TOTAL_SIZE) throw new Error('Skill 总大小超过安全限制')

      const destination = join(stagingDir, ...nextRelative)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content)
    }
  }

  await visit(sourcePath, [])
  if (!await pathExists(join(stagingDir, 'SKILL.md'))) {
    throw new Error('Skill 包缺少 SKILL.md')
  }
}

async function validateSkillManifest(stagingDir: string, expectedId: string): Promise<void> {
  const content = await readFile(join(stagingDir, 'SKILL.md'), 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!frontmatter) throw new Error('SKILL.md 缺少有效的 YAML 元数据')

  let parsed: unknown
  try {
    parsed = parseYaml(frontmatter[1])
  } catch {
    throw new Error('SKILL.md 的 YAML 元数据无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SKILL.md 的 YAML 元数据无效')
  }

  const metadata = parsed as Record<string, unknown>
  if (metadata.name !== expectedId) {
    throw new Error(`Skill 名称与精选目录不一致: ${String(metadata.name || '未提供')}`)
  }
  if (typeof metadata.description !== 'string' || metadata.description.trim().length === 0) {
    throw new Error('SKILL.md 缺少 description')
  }
}

async function replaceDirectory(stagingDir: string, targetDir: string): Promise<void> {
  const backupDir = `${targetDir}.backup-${process.pid}-${randomUUID()}`
  let movedExistingTarget = false
  try {
    if (await pathExists(targetDir)) {
      await rename(targetDir, backupDir)
      movedExistingTarget = true
    }
    await rename(stagingDir, targetDir)
    await rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    if (movedExistingTarget && !await pathExists(targetDir) && await pathExists(backupDir)) {
      await rename(backupDir, targetDir)
    }
    throw error
  }
}

export async function inspectCommunitySkillInstallation(
  targetRoot: string,
  skillId: string,
): Promise<CommunitySkillInstallation | null> {
  assertSafeSegment(skillId, 'Skill id')
  const metadata = await readManagedMetadata(join(targetRoot, skillId), skillId)
  return metadata ? {
    installedAt: metadata.installedAt,
    updatedAt: metadata.updatedAt,
    sourceRef: metadata.sourceRef || '',
  } : null
}

export async function installCommunitySkill(options: CommunitySkillInstallerOptions): Promise<void> {
  assertSafeSegment(options.skill.id, 'Skill id')
  const targetDir = join(options.targetRoot, options.skill.id)
  const existingMetadata = await readManagedMetadata(targetDir, options.skill.id)
  if (await pathExists(targetDir) && !existingMetadata) {
    throw new Error('同名 Skill 已存在，且不是由 sumi 安装，已保留原内容')
  }

  await mkdir(options.targetRoot, { recursive: true })
  const stagingDir = `${targetDir}.staging-${process.pid}-${randomUUID()}`
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    await downloadDirectory(options, stagingDir)
    await validateSkillManifest(stagingDir, options.skill.id)
    const now = new Date().toISOString()
    const metadata: CommunitySkillMetadata = {
      schemaVersion: 1,
      managedBy: 'sumi',
      id: options.skill.id,
      sourcePageUrl: options.skill.sourcePageUrl,
      repositoryUrl: options.skill.repositoryUrl,
      sourceRef: options.skill.source.ref,
      installedAt: existingMetadata?.installedAt || now,
      ...(existingMetadata ? { updatedAt: now } : {}),
    }
    await writeFile(join(stagingDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    await replaceDirectory(stagingDir, targetDir)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

export async function uninstallCommunitySkill(targetRoot: string, skillId: string): Promise<void> {
  assertSafeSegment(skillId, 'Skill id')
  const targetDir = join(targetRoot, skillId)
  if (!await pathExists(targetDir)) return
  if (!await readManagedMetadata(targetDir, skillId)) {
    throw new Error('该 Skill 不是由 sumi 安装，无法自动卸载')
  }
  await rm(targetDir, { recursive: true, force: true })
}
