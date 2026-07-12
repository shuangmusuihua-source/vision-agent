import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'path'
import { getAppUserDataDir } from './app-identity'

export type AgentMemoryMode = 'global' | 'disabled'

const GLOBAL_MEMORY_DIRECTORY_NAME = 'memory'

export const GLOBAL_MEMORY_PROMPT = `你可以使用 sumi 的全局自动记忆。它只用于保存与用户强相关、跨工作区长期有效，并且模型本身无法可靠知道的信息。

写入记忆前必须同时满足：
1. 信息与用户本人、长期目标、稳定偏好、固定约束或反复确认的工作习惯直接相关。
2. 信息预计会在未来不同任务或工作区中继续有用。
3. 信息不是通用世界知识，也不是可以随时从文档、知识库或联网检索重新获得的内容。
4. 信息不是任务日志、执行进度、临时状态、文件快照、时间戳、会话 ID、任务 ID、错误重试记录或本次生成的文档内容。
5. 信息不是未经用户确认的推断，也不得包含密码、令牌、API Key 等秘密。

维护规则：
- 不确定是否值得长期记忆时，不要写入。
- 优先更新、合并或纠正已有条目，禁止按时间线无限追加重复记录。
- MEMORY.md 必须保持为简短索引；较详细但仍长期有效的内容放入按主题命名的 Markdown 文件。
- 自动化运行结果属于自动化历史，项目资料属于知识库，具体任务上下文属于会话，均不得写入全局记忆。`

export function getGlobalMemoryDirectory(): string {
  return join(getAppUserDataDir(), GLOBAL_MEMORY_DIRECTORY_NAME)
}

export function getAgentMemorySettings(mode: AgentMemoryMode): Pick<Settings, 'autoMemoryEnabled' | 'autoMemoryDirectory'> {
  if (mode === 'disabled') return { autoMemoryEnabled: false }
  return {
    autoMemoryEnabled: true,
    autoMemoryDirectory: getGlobalMemoryDirectory(),
  }
}
