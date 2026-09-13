import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildAgentOptions } from './agent-options'
import { getAppUserDataDir } from './app-identity'
import { getActiveProfileUsageIdentity } from './persistence/profile-store'
import { recordModelUsage } from './persistence/model-usage-store'
import { CurationJobs } from './curation-jobs'
import type { LlmClient } from './vendor/tencent-agent-memory/llm'

export const curationJobs = new CurationJobs()

export async function withCurationModel<T>(
  input: { owner: number; requestId: string; sessionId?: string; workspacePath?: string; source: 'knowledge-curation' | 'skill-distillation' },
  operation: (llm: LlmClient, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return curationJobs.run(input.owner, input.requestId, input, async signal => {
    const root = join(getAppUserDataDir(), '.sumi', 'curation-runs')
    await mkdir(root, { recursive: true })
    const cwd = await mkdtemp(join(root, 'run-'))
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) controller.abort()
    try {
      const profile = getActiveProfileUsageIdentity()
      const options = buildAgentOptions({
        cwd, memoryMode: 'disabled', permissionMode: 'default', settingSources: [], skills: [],
        allowedTools: [], prependUserBinPaths: false, maxTurns: 1,
        canUseTool: async () => ({ behavior: 'deny', message: '资料整理不允许调用工具' }),
      })
      options.tools = []
      options.persistSession = false
      options.abortController = controller
      const llm: LlmClient = {
        async chat(params) {
          signal.throwIfAborted()
          for await (const message of query({ prompt: params.prompt, options: { ...options, systemPrompt: params.system } })) {
            if (message.type !== 'result') continue
            recordModelUsage({ result: message, profile, source: input.source,
              sessionId: input.sessionId || input.requestId,
              sessionTitle: input.source === 'knowledge-curation' ? '知识整理' : '个人 Skill 提炼', workspaceName: '' })
            if (message.subtype !== 'success') throw new Error('模型未能完成整理，请重试')
            signal.throwIfAborted()
            if (!message.result.trim() && params.label !== 'merge-append') throw new Error('模型返回了空结果，请重试')
            return message.result
          }
          throw new Error('整理未返回完整结果，请重试')
        },
      }
      return await operation(llm, signal)
    } finally {
      signal.removeEventListener('abort', abort)
      await rm(cwd, { recursive: true, force: true })
    }
  })
}
