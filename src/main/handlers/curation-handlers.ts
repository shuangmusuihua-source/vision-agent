import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { extname, resolve } from 'path'
import type { IPCRequest, IPCResponse, IPCChannelMap } from '../../shared/ipc-types'
import type { AgentIPCMessage } from '../../shared/types'
import type { CurationDraft } from '../../shared/curation-types'
import { KnowledgeLibrary } from '../knowledge-library'
import type { PersonalSkills } from '../personal-skills'
import { withCurationModel, curationJobs } from '../curation-runtime'
import { getKnowledgeBaseDir } from '../persistence/store-core'
import { getSessionRecordById } from '../persistence/workspace-store'
import { getEnabledSkills, toggleSkill } from '../persistence/settings-store'
import { loadSessionTranscriptPage } from '../session-transcript'
import { getSessionFileOutputs } from '../session-file-catalog'
import { decideSessionFileAccess } from '../session-file-access'
import { assertSnapshotsCurrent, readTextSnapshot, type TextSnapshot } from '../curation-files'
import { getAppSkillsCwd, getAppSkillsDir } from '../skill-init'
import { isManagedSessionWorkingDirectory } from '../session-files'
import { isAuthorizedSessionWorkspace } from '../path-validator'
import { sessionRuntime } from '../session-runtime'

function sessionScope(sessionId: string) {
  if (typeof sessionId !== 'string') throw new Error('请选择一个已完成的任务')
  const record = getSessionRecordById(sessionId)
  if (!record?.workingDirectory || record.id !== sessionId) throw new Error('任务记录不存在或尚未开始')
  const validate = () => {
    const current = getSessionRecordById(sessionId)
    if (!current || current.workingDirectory !== record.workingDirectory || current.sdkSessionId !== record.sdkSessionId
      || current.context !== record.context || current.workspacePath !== record.workspacePath
      || current.lastModified !== record.lastModified || sessionRuntime.getEnvelope(sessionId)
      || (current.context === 'ask' && (current.workspacePath !== getAppSkillsCwd()
        || !isManagedSessionWorkingDirectory(getAppSkillsCwd(), current.workingDirectory!, 'ask')))
      || (current.context === 'editor' && !isAuthorizedSessionWorkspace(current.workspacePath))) {
      throw new Error('任务已变化或仍在执行，请等待完成后重新提炼')
    }
  }
  validate()
  return { record, validate }
}

/** Excludes thinking, tool payloads, and meta messages; only visible dialogue is reused. */
export function curationTranscript(messages: AgentIPCMessage[]): string {
  return messages.flatMap(message => {
    if (message.type !== 'user' && message.type !== 'assistant') return []
    if (message.type === 'user' && message.isMeta) return []
    const content = message.message.content
    const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    return text.trim() ? [`<<past-${message.type}>>\n${text}`] : []
  }).join('\n\n').slice(-80_000) + '\n<<end-of-transcript>>'
}

export function registerCurationHandlers(personal: PersonalSkills, changed: (id: string, reason: 'installed' | 'updated' | 'uninstalled') => void): void {
  const library = new KnowledgeLibrary(getKnowledgeBaseDir())
  const owners = new Set<number>()
  // Same typed contract as preload; failures remain dismissible in the invoking surface.
  const handleCuration = <C extends keyof IPCChannelMap>(channel: C, operation: (event: IpcMainInvokeEvent, request: IPCRequest<C>) => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, async (event, request: IPCRequest<C>): Promise<IPCResponse<C>> => {
      if (!owners.has(event.sender.id)) {
        const owner = event.sender.id
        owners.add(owner)
        event.sender.once('destroyed', () => {
          curationJobs.cancelAll(owner); library.discardOwner(owner); personal.discardOwner(owner); owners.delete(owner)
        })
      }
      try { return { success: true, value: await operation(event, request) } as IPCResponse<C> } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '操作失败，请重试' } as IPCResponse<C>
      }
    })
  }
  handleCuration('graph:knowledgeCatalog', () => library.catalog())
  handleCuration('graph:prepareKnowledge', async (event, request) => {
    const scope = request.sessionId ? sessionScope(request.sessionId) : null
    let draft: CurationDraft | undefined
    try {
      return await withCurationModel({ owner: event.sender.id, requestId: request.requestId, sessionId: request.sessionId,
        workspacePath: scope?.record.workspacePath, source: 'knowledge-curation' }, async (llm, signal) => {
        draft = await library.prepare(event.sender.id, request.paths, llm, () => { signal.throwIfAborted(); scope?.validate() })
        return draft
      })
    } catch (error) {
      if (draft) library.discard(event.sender.id, draft.id)
      throw error
    }
  })
  handleCuration('graph:saveKnowledge', (event, request) => library.save(event.sender.id, request))
  handleCuration('graph:undoKnowledge', () => library.undo())
  handleCuration('graph:discardDraft', (event, id) => library.discard(event.sender.id, id))
  handleCuration('graph:cancelPreparation', (event, id) => curationJobs.cancel(event.sender.id, id))

  handleCuration('skills:listPersonal', () => personal.list(getEnabledSkills()))
  handleCuration('skills:preparePersonal', async (event, request) => {
    const { record, validate } = sessionScope(request.sessionId)
    let draft: CurationDraft | undefined
    try {
      return await withCurationModel({ owner: event.sender.id, requestId: request.requestId, sessionId: record.id,
        workspacePath: record.workspacePath, source: 'skill-distillation' }, async (llm, signal) => {
        const page = await loadSessionTranscriptPage(record.id, 100, null)
        const transcript = curationTranscript(page.messages)
        if (!page.messages.length) throw new Error('尚无可提炼的任务对话')
        let artifact: string | undefined
        let artifactSnapshot: TextSnapshot | undefined
        if (request.artifactPath) {
          const output = (await getSessionFileOutputs(record.id)).find(file => file.filePath === resolve(request.artifactPath!))
          if (!output || decideSessionFileAccess({ toolName: 'Read', input: { file_path: output.filePath },
            workingDirectory: record.workingDirectory!, skillsDirectory: getAppSkillsDir(), authorizedMemoryDirectory: null }) !== 'allow') {
            throw new Error('所选成果不属于这个任务')
          }
          if (/\.(md|txt|html|csv)$/i.test(extname(output.filePath))) {
            artifactSnapshot = await readTextSnapshot(record.workingDirectory!, output.filePath, 160_000)
            if (artifactSnapshot.content === null) throw new Error('所选成果已被移除，请重新选择')
            artifact = artifactSnapshot.content
          } else artifact = `成果：${output.fileName}。二进制内容未读取，仅参考任务对话中的制作过程。`
        }
        draft = await personal.prepare(event.sender.id, { transcript, artifact, instruction: request.instruction, skillId: request.skillId }, llm, async () => {
          signal.throwIfAborted(); validate()
          if (artifactSnapshot) await assertSnapshotsCurrent(record.workingDirectory!, [artifactSnapshot])
        })
        if (page.hasMore || transcript.length >= 80_000) draft.notice += ' 长任务只参考最近一段对话，请核对遗漏的步骤。'
        return draft
      })
    } catch (error) {
      if (draft) personal.discard(event.sender.id, draft.id)
      throw error
    }
  })
  handleCuration('skills:editPersonal', (event, id) => personal.edit(event.sender.id, id))
  handleCuration('skills:savePersonal', async (event, request) => {
    const installed = new Set((await personal.list()).map(skill => skill.id))
    const id = await personal.save(event.sender.id, request)
    if (!installed.has(id)) toggleSkill(id, true)
    changed(id, installed.has(id) ? 'updated' : 'installed')
    return id
  })
  handleCuration('skills:deletePersonal', async (_event, id) => {
    await personal.remove(id)
    toggleSkill(id, false)
    changed(id, 'uninstalled')
  })
  handleCuration('skills:discardDraft', (event, id) => personal.discard(event.sender.id, id))
  handleCuration('skills:cancelPreparation', (event, id) => curationJobs.cancel(event.sender.id, id))
}
