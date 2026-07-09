import { dirname } from 'path'
import { query, startup, type Options } from '@anthropic-ai/claude-agent-sdk'
import { buildAgentOptions } from './agent-options'
import { INLINE_REWRITE_MAX_TURNS, InlineRewriteRunner } from './inline-rewrite-core'

const INLINE_REWRITE_SYSTEM_PROMPT = `你是 Markdown 编辑器中的行内改写引擎。
严格根据用户的修改要求改写选中内容，并遵守以下规则：
1. 只返回可直接替换原选区的 Markdown，不解释过程。
2. 除非修改要求明确要求改变，否则保持原文语言、事实、语气、Markdown 结构和格式。
3. 不重复前后文，不添加代码围栏包裹最终答案。
4. 前后文仅用于理解衔接，不得改写或返回前后文。`

export function createInlineRewriteOptions(
  filePath: string,
  abortController: AbortController,
): Options {
  const options = buildAgentOptions({
    cwd: dirname(filePath),
    permissionMode: 'default',
    allowedTools: [],
    settingSources: [],
    skills: [],
    prependUserBinPaths: false,
    effort: 'low',
    maxTurns: INLINE_REWRITE_MAX_TURNS,
    canUseTool: async () => ({ behavior: 'deny', message: '行内改写不允许调用工具' }),
  })
  options.abortController = abortController
  options.persistSession = false
  options.systemPrompt = INLINE_REWRITE_SYSTEM_PROMPT
  return options
}

export const inlineRewriteRunner = new InlineRewriteRunner(
  query,
  createInlineRewriteOptions,
  (options) => startup({ options }),
  (metrics) => console.info('[InlineRewrite] completed', metrics),
)
