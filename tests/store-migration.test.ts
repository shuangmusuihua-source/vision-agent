import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    authorizedDirectories: [] as string[],
    fixedDirectories: [] as string[],
    workspaces: [] as Array<Record<string, unknown>>,
    sessions: [] as Array<Record<string, unknown>>,
    sessionArtifacts: [] as Array<Record<string, unknown>>,
    compactionSessionIds: [] as string[],
    storeVersion: 1,
  },
  appUserDataDir: '',
  appSkillsCwd: '',
  deleteSession: vi.fn(async () => undefined),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  deleteSession: mocks.deleteSession,
}))

vi.mock('../src/main/app-identity', () => ({
  getAppUserDataDir: () => mocks.appUserDataDir,
}))

vi.mock('../src/main/skill-init', () => ({
  getAppSkillsCwd: () => mocks.appSkillsCwd,
}))

vi.mock('../src/main/persistence/store-core', () => ({
  store: {
    get: vi.fn((key: keyof typeof mocks.state) => mocks.state[key]),
    set: vi.fn((key: keyof typeof mocks.state, value: unknown) => {
      mocks.state[key] = value as never
    }),
    delete: vi.fn((key: keyof typeof mocks.state) => {
      delete (mocks.state as Partial<typeof mocks.state>)[key]
    }),
  },
}))

const tempDirs: string[] = []

afterEach(async () => {
  mocks.deleteSession.mockClear()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('store migration', () => {
  it('clears tracked session history while preserving workspace records', async () => {
    vi.resetModules()
    const { migrateStore } = await import('../src/main/store-migration')
    const root = await mkdtemp(join(tmpdir(), 'sumi-store-migration-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const workingDirectory = join(workspace, '.sumi', 'sessions', 'session-a')
    const snapshotDirectory = join(root, 'app-data', 'session-artifacts')
    mocks.appUserDataDir = join(root, 'app-data')
    mocks.appSkillsCwd = join(root, 'ask')
    await mkdir(workingDirectory, { recursive: true })
    await mkdir(snapshotDirectory, { recursive: true })
    await writeFile(join(workingDirectory, 'report.md'), '# Report')
    await writeFile(join(snapshotDirectory, 'legacy.md'), '# Legacy')

    const workspaceRecord = {
      id: 'workspace-a',
      name: 'Workspace',
      path: workspace,
      isFixed: false,
      createdAt: 1,
      lastOpenedAt: 1,
    }
    mocks.state.authorizedDirectories = [workspace]
    mocks.state.fixedDirectories = []
    mocks.state.workspaces = [workspaceRecord]
    mocks.state.sessions = [{
      id: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: workspace,
      workingDirectory,
      context: 'editor',
    }]
    mocks.state.sessionArtifacts = [{ id: 'artifact-a' }]
    mocks.state.compactionSessionIds = ['sdk-compaction-a']
    mocks.state.storeVersion = 1

    await migrateStore()

    expect(mocks.state.workspaces).toEqual([workspaceRecord])
    expect(mocks.state.sessions).toEqual([])
    expect(mocks.state.sessionArtifacts).toBeUndefined()
    expect(mocks.state.compactionSessionIds).toEqual([])
    expect(mocks.state.storeVersion).toBe(4)
    expect(mocks.deleteSession).toHaveBeenCalledWith('sdk-session-a', { dir: workingDirectory })
    expect(mocks.deleteSession).toHaveBeenCalledWith('sdk-compaction-a', { dir: workingDirectory })
    await expect(access(join(workspace, '.sumi', 'sessions'))).rejects.toThrow()
    await expect(access(snapshotDirectory)).rejects.toThrow()
  })

  it('migrates shared Ask history to isolated Ask session storage without deleting editor sessions', async () => {
    vi.resetModules()
    const { migrateStore } = await import('../src/main/store-migration')
    const root = await mkdtemp(join(tmpdir(), 'sumi-store-migration-v4-'))
    tempDirs.push(root)
    const appData = join(root, 'app-data')
    const editorWorkingDirectory = join(root, 'workspace', '.sumi', 'sessions', 'editor-a')
    await mkdir(editorWorkingDirectory, { recursive: true })
    mocks.appUserDataDir = appData
    mocks.appSkillsCwd = appData
    mocks.state.authorizedDirectories = [join(root, 'workspace')]
    mocks.state.fixedDirectories = []
    mocks.state.workspaces = []
    mocks.state.sessions = [
      {
        id: 'editor-app',
        sdkSessionId: 'editor-sdk',
        workspacePath: join(root, 'workspace'),
        workingDirectory: editorWorkingDirectory,
        context: 'editor',
      },
      {
        id: 'ask-app',
        sdkSessionId: 'ask-sdk',
        workspacePath: appData,
        workingDirectory: appData,
        context: 'ask',
      },
    ]
    mocks.state.sessionArtifacts = []
    mocks.state.compactionSessionIds = []
    mocks.state.storeVersion = 3
    mocks.deleteSession.mockClear()

    await migrateStore()

    expect(mocks.state.sessions).toEqual([expect.objectContaining({ id: 'editor-app' })])
    expect(mocks.state.storeVersion).toBe(4)
    expect(mocks.deleteSession).toHaveBeenCalledWith('ask-sdk', { dir: appData })
    await expect(access(editorWorkingDirectory)).resolves.toBeUndefined()
  })
})
