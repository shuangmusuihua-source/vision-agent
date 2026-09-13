import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalSkills } from '../src/main/personal-skills'
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>(),
  record: { id: 'app-a', sdkSessionId: 'sdk-a', workingDirectory: '/workspace/.sumi/sessions/a', workspacePath: '/workspace', lastModified: 1, context: 'editor' },
  active: false, authorized: true, page: vi.fn(), model: vi.fn(), outputs: vi.fn(), cancel: vi.fn(), snapshot: vi.fn(), checkSnapshots: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: never) => state.handlers.set(name, handler) } }))
vi.mock('../src/main/curation-runtime', () => ({ withCurationModel: state.model, curationJobs: { cancelAll: state.cancel, cancel: state.cancel } }))
vi.mock('../src/main/persistence/store-core', () => ({ getKnowledgeBaseDir: () => '/knowledge' }))
vi.mock('../src/main/persistence/workspace-store', () => ({ getSessionRecordById: (id: string) => id === 'app-a' ? { ...state.record } : undefined }))
vi.mock('../src/main/persistence/settings-store', () => ({ getEnabledSkills: () => [], toggleSkill: vi.fn() }))
vi.mock('../src/main/session-transcript', () => ({ loadSessionTranscriptPage: state.page }))
vi.mock('../src/main/session-file-catalog', () => ({ getSessionFileOutputs: state.outputs }))
vi.mock('../src/main/skill-init', () => ({ getAppSkillsDir: () => '/skills', getAppSkillsCwd: () => '/app-data' }))
vi.mock('../src/main/curation-files', async importOriginal => ({ ...await importOriginal<object>(), readTextSnapshot: state.snapshot, assertSnapshotsCurrent: state.checkSnapshots }))
vi.mock('../src/main/path-validator', () => ({ isAuthorizedSessionWorkspace: () => state.authorized }))
vi.mock('../src/main/session-runtime', () => ({ sessionRuntime: { getEnvelope: () => state.active ? {} : null } }))
const { registerCurationHandlers, curationTranscript } = await import('../src/main/handlers/curation-handlers')
const personal = { prepare: vi.fn(), save: vi.fn(), list: vi.fn(), edit: vi.fn(), discard: vi.fn(), discardOwner: vi.fn(), remove: vi.fn() }
const sender = { id: 4, once: vi.fn() }
beforeEach(() => {
  state.handlers.clear(); state.active = false; state.authorized = true; state.record.lastModified = 1
  state.record.context = 'editor'; state.record.workspacePath = '/workspace'; state.record.workingDirectory = '/workspace/.sumi/sessions/a'
  state.snapshot.mockReset(); state.checkSnapshots.mockReset(); personal.discard.mockClear()
  state.model.mockReset().mockImplementation(async (_input, operation) => operation({}, new AbortController().signal))
  state.page.mockReset().mockResolvedValue({ messages: [{ type: 'user', message: { content: '帮我完成研究' } }], hasMore: false })
  state.outputs.mockReset().mockResolvedValue([])
  personal.prepare.mockReset().mockImplementation(async (_owner, _input, _llm, validate) => { await validate(); return { id: 'draft', files: [] } })
  registerCurationHandlers(personal as unknown as PersonalSkills, () => {})
})
const invoke = (request: unknown) => state.handlers.get('skills:preparePersonal')!({ sender }, request)

describe('curation IPC session boundary', () => {
  it('uses the canonical app session and captures its scope', async () => {
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a', instruction: '' })).resolves.toMatchObject({ success: true })
    expect(state.page).toHaveBeenCalledWith('app-a', 100, null)
    expect(state.model).toHaveBeenCalledWith(expect.objectContaining({ owner: 4, sessionId: 'app-a', workspacePath: '/workspace' }), expect.any(Function))
    expect(personal.prepare.mock.calls[0][0]).toBe(4)
    await expect(invoke({ requestId: 'r2', sessionId: 'sdk-a', instruction: '' })).resolves.toMatchObject({ success: false })
  })
  it('refuses running, unauthorized, or changed sessions', async () => {
    state.active = true
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a' })).resolves.toMatchObject({ success: false })
    state.active = false; state.authorized = false
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a' })).resolves.toMatchObject({ success: false })
    state.authorized = true
    personal.prepare.mockImplementation(async (_owner, _input, _llm, validate) => { state.record.lastModified++; await validate() })
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a', instruction: '' })).resolves.toMatchObject({ success: false, error: expect.stringContaining('任务已变化') })
  })
  it('does not read another task’s artifact', async () => {
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a', artifactPath: '/other/secret.md', instruction: '' })).resolves.toMatchObject({ success: false, error: expect.stringContaining('不属于') })
    expect(personal.prepare).not.toHaveBeenCalled()
  })
  it('rechecks the selected artifact before saving the draft', async () => {
    const artifactPath = '/workspace/.sumi/sessions/a/result.md'
    state.outputs.mockResolvedValue([{ filePath: artifactPath, fileName: 'result.md' }])
    state.snapshot.mockResolvedValue({ path: artifactPath, content: 'original artifact', hash: 'original' })
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a', artifactPath, instruction: '' })).resolves.toMatchObject({ success: true })
    const validate = personal.prepare.mock.calls[0][3]
    state.checkSnapshots.mockRejectedValue(new Error('资料或主题已更新'))
    await expect(validate()).rejects.toThrow('已更新')
  })
  it('rejects a moved Ask scope and discards a result cancelled during runtime cleanup', async () => {
    state.record.context = 'ask'
    await expect(invoke({ requestId: 'r1', sessionId: 'app-a', instruction: '' })).resolves.toMatchObject({ success: false })
    state.record.context = 'editor'
    state.model.mockImplementation(async (_input, operation) => {
      await operation({}, new AbortController().signal)
      throw new Error('cancelled during cleanup')
    })
    await expect(invoke({ requestId: 'r2', sessionId: 'app-a', instruction: '' })).resolves.toMatchObject({ success: false })
    expect(personal.discard).toHaveBeenCalledWith(4, 'draft')
  })
  it('keeps hidden reasoning, tool results, and meta messages out of Skill input', () => {
    const transcript = curationTranscript([
      { type: 'user', isMeta: true, message: { content: 'internal metadata' } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'visible answer' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'raw private tool payload' }, { type: 'text', text: 'user correction' }] } },
    ] as never)
    expect(transcript).toContain('visible answer'); expect(transcript).toContain('user correction')
    expect(transcript).not.toMatch(/private|internal metadata/)
  })
})
