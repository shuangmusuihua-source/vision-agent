# Claude Agent SDK 官方指南 vs 当前实现 对比报告

> 生成时间: 2026-06-11
> SDK版本: @anthropic-ai/claude-agent-sdk (当前项目依赖版本)
> 参考文档: https://code.claude.com/docs/en/agent-sdk/

---

## 一、总览

| 维度 | SDK 官方能力 | 当前实现状态 | 差距评级 |
|------|-------------|-------------|---------|
| 核心 query() | ✅ 完整 | ✅ 已使用 | 🟢 匹配 |
| 会话管理 | ✅ continue/resume/fork/list/rename/tag | ⚠️ 部分使用 | 🟡 中等 |
| 权限系统 | ✅ 6种模式 + canUseTool + hooks | ⚠️ 自定义实现 | 🟡 中等 |
| Hooks 系统 | ✅ 20种事件类型 | ⚠️ 仅3种 | 🔴 较大 |
| 子代理(Subagents) | ✅ AgentDefinition + 并行 + 动态配置 | ❌ 未使用 | 🔴 较大 |
| MCP 服务器 | ✅ 4种传输 + 运行时管理 | ❌ 未使用 | 🔴 较大 |
| 自定义工具 | ✅ tool() + createSdkMcpServer() | ❌ 未使用 | 🔴 较大 |
| Skills | ✅ 'all' / 列表 / 插件 | ⚠️ 基础使用 | 🟡 中等 |
| 流式输出 | ✅ includePartialMessages | ❌ 未使用 | 🟡 中等 |
| 文件检查点 | ✅ enableFileCheckpointing + rewindFiles | ❌ 未使用 | 🟡 中等 |
| 会话存储适配器 | ✅ SessionStore (S3/Redis/Postgres) | ❌ 未使用 | 🟢 暂不需要 |
| 成本追踪 | ✅ total_cost_usd + modelUsage | ⚠️ 基础使用 | 🟡 中等 |
| 启动预热 | ✅ startup() → WarmQuery | ❌ 未使用 | 🟡 中等 |
| 结构化输出 | ✅ outputFormat + JSON Schema | ❌ 未使用 | 🟡 中等 |

---

## 二、详细对比分析

### 2.1 会话管理 — 🟡 中等差距

#### SDK 官方能力

| 功能 | SDK API | 说明 |
|------|---------|------|
| 继续最近会话 | `continue: true` | 自动找最近session，无需ID |
| 恢复指定会话 | `resume: sessionId` | 精确恢复特定session |
| 分叉会话 | `forkSession: true` | 从原session分叉，原session不变 |
| 禁用持久化 | `persistSession: false` | 仅内存session，不写磁盘 |
| 列出会话 | `listSessions({ dir, limit })` | 按目录/数量过滤 |
| 读取消息 | `getSessionMessages(sessionId, { limit, offset })` | 分页读取历史 |
| 获取会话信息 | `getSessionInfo(sessionId)` | 单条元数据查询 |
| 重命名会话 | `renameSession(sessionId, title)` | 用户友好标题 |
| 标记会话 | `tagSession(sessionId, tag)` | 组织/分类 |
| 分叉(独立函数) | `forkSession({ sessionStore })` | 带存储适配器的分叉 |
| 指定Session ID | `sessionId: string` | 使用自定义UUID |
| 恢复到指定消息 | `resumeSessionAt: string` | 从特定消息UUID恢复 |

#### 当前实现

- ✅ 使用 `resume: sessionId` 恢复会话
- ✅ 使用 `listSessions`, `getSessionMessages`, `renameSession`, `deleteSession`
- ✅ 追踪 compaction sessions 并过滤
- ❌ **未使用 `continue: true`** — 多轮对话完全依赖手动 sessionId 追踪
- ❌ **未使用 `forkSession`** — 无法在不丢失原历史的情况下探索替代方案
- ❌ **未使用 `tagSession`** — 无法给会话打标签分类
- ❌ **未使用 `resumeSessionAt`** — 无法从特定消息点恢复
- ❌ **未使用 `persistSession: false`** — 对临时性任务（如cron）无优化
- ❌ **三重会话存储** — SDK JSONL + electron-store SessionRecord + 内存 SessionInfo，存在不一致风险

#### 改进建议

1. **用 `continue: true` 简化多轮对话**: 当前应用是单用户桌面应用，`continue: true` 可自动找到最近session，无需手动追踪ID
2. **实现 `forkSession`**: 用户想尝试不同方案时，可分叉而不丢失原始对话
3. **用 `tagSession` 组织会话**: 按项目/任务类型打标签，改善会话列表体验
4. **统一会话存储**: 移除 `agent-sessions.ts` 的内存追踪，直接使用 SDK 的 `listSessions()` 和 `getSessionInfo()`
5. **Cron 任务使用 `persistSession: false`**: 临时性任务无需写磁盘，减少 I/O

---

### 2.2 权限系统 — 🟡 中等差距

#### SDK 官方能力

权限评估顺序（6步）:
1. **Hooks** → 可 allow/deny/ask/defer
2. **Deny rules** → `disallowedTools` 不可覆盖
3. **Ask rules** → settings.json 中配置
4. **Permission mode** → 6种模式
5. **Allow rules** → `allowedTools` 预批准
6. **canUseTool** → 运行时回调

Permission modes:
| 模式 | 行为 |
|------|------|
| `default` | 未匹配工具触发 canUseTool |
| `dontAsk` | 未预批准则直接拒绝 |
| `acceptEdits` | 自动批准文件编辑+文件系统命令 |
| `bypassPermissions` | 全部批准（危险） |
| `plan` | 只读探索+计划，编辑必须审批 |
| `auto` | 模型分类器自动决策 |

动态权限:
- `setPermissionMode()` — 会话中切换模式
- `applyFlagSettings({ permissions })` — 运行时修改权限规则
- `canUseTool` 的 `suggestions` → 返回 `updatedPermissions` 持久化规则

#### 当前实现

- ✅ 使用 `canUseTool` 回调处理权限请求
- ✅ 自动批准只读工具 (WebSearch, WebFetch, Glob, Grep)
- ✅ 路径授权检查
- ✅ 5分钟超时机制
- ✅ AskUserQuestion 独立处理流程
- ⚠️ **自定义 pending permission map** — 而非依赖 SDK 内置机制
- ❌ **未使用 `disallowedTools`** — 无法声明式阻止危险工具
- ❌ **未使用 `setPermissionMode()`** — 无法运行时切换权限模式
- ❌ **未使用 `applyFlagSettings()`** — 无法动态修改权限规则
- ❌ **未利用 `suggestions` 持久化** — 用户每次都要重新审批相同操作
- ❌ **未实现 `plan` 模式** — 无法先探索再编辑的工作流
- ❌ **Cron 使用 `acceptEdits` 但无 `disallowedTools`** — cron 代理理论上可执行任何 Bash 命令

#### 改进建议

1. **实现 `suggestions` 持久化**: `canUseTool` 的 `options.suggestions` 包含预生成的权限规则，返回 `updatedPermissions` 可写入 `.claude/settings.local.json`，用户选择"始终允许"后不再重复提示
2. **使用 `disallowedTools` 声明式限制**: 对 cron 任务添加 `disallowedTools: ['Bash(rm -rf *)', 'Bash(curl *)']` 等规则
3. **添加 `plan` 模式支持**: 让用户先让 Claude 探索和分析，确认计划后再切换到编辑模式
4. **运行时 `setPermissionMode()`**: 在流式输入模式下，用户可以实时切换权限严格度
5. **路径授权改用 `additionalDirectories`**: 将授权路径通过 SDK 原生选项传递

---

### 2.3 Hooks 系统 — 🔴 较大差距

#### SDK 官方能力 (20种 Hook 事件)

| Hook 事件 | TS | PY | 当前使用 |
|-----------|:--:|:--:|:--------:|
| `PreToolUse` | ✅ | ✅ | ✅ 审计日志 |
| `PostToolUse` | ✅ | ✅ | ✅ 审计日志 |
| `PostToolUseFailure` | ✅ | ✅ | ❌ |
| `PostToolBatch` | ✅ | ❌ | ❌ |
| `UserPromptSubmit` | ✅ | ✅ | ❌ |
| `MessageDisplay` | ✅ | ❌ | ❌ |
| `Stop` | ✅ | ✅ | ❌ |
| `SubagentStart` | ✅ | ✅ | ❌ |
| `SubagentStop` | ✅ | ✅ | ❌ |
| `PreCompact` | ✅ | ✅ | ❌ |
| `PermissionRequest` | ✅ | ✅ | ❌ |
| `SessionStart` | ✅ | ❌ | ❌ |
| `SessionEnd` | ✅ | ❌ | ❌ |
| `Notification` | ✅ | ✅ | ✅ 转发到渲染进程 |
| `Setup` | ✅ | ❌ | ❌ |
| `TeammateIdle` | ✅ | ❌ | ❌ |
| `TaskCompleted` | ✅ | ❌ | ❌ |
| `ConfigChange` | ✅ | ❌ | ❌ |
| `WorktreeCreate` | ✅ | ❌ | ❌ |
| `WorktreeRemove` | ✅ | ❌ | ❌ |

#### 当前实现

仅使用 3 种 Hook:
```typescript
function buildHooks(mainWindow, sessionId, workspaceCwd) {
  return {
    PreToolUse: [{ hooks: [auditPreToolUse] }],   // 审计日志
    PostToolUse: [{ hooks: [auditPostToolUse] }],  // 审计日志
    Notification: [{ hooks: [notificationHook] }]  // 转发通知
  }
}
```

审计日志截断到 500 字符，丢失重要上下文。

#### 高价值未使用的 Hooks

| Hook | 应用场景 | 价值 |
|------|---------|------|
| `Stop` | Agent 完成时保存状态、触发后续操作 | 🔴 高 |
| `PreCompact` | 压缩前归档完整对话记录 | 🔴 高 |
| `SubagentStart/Stop` | 跟踪子代理执行状态 | 🟡 中 |
| `UserPromptSubmit` | 注入额外上下文（如当前打开文件） | 🔴 高 |
| `PermissionRequest` | 权限请求时发送外部通知 | 🟡 中 |
| `SessionStart/End` | 初始化/清理资源 | 🟡 中 |
| `PostToolUseFailure` | 工具失败时自动重试或通知 | 🟡 中 |
| `MessageDisplay` | 在显示前过滤/重写敏感信息 | 🟡 中 |

#### 改进建议

1. **`UserPromptSubmit` 注入编辑器上下文**: 用户发送消息时，自动附加当前打开的文件、光标位置等信息，无需手动复制粘贴
2. **`Stop` 保存状态**: Agent 完成时自动保存会话摘要、更新文件索引
3. **`PreCompact` 归档**: 压缩前将完整对话保存到独立存储，防止信息丢失
4. **`PostToolUseFailure` 错误恢复**: 工具失败时自动重试或通知用户
5. **审计日志使用 matcher**: 当前对所有工具都触发审计，应只对敏感工具（Write, Edit, Bash）使用 matcher 过滤
6. **移除 500 字符截断**: 使用完整日志或至少 5000 字符

---

### 2.4 子代理 (Subagents) — 🔴 较大差距

#### SDK 官方能力

```typescript
agents: {
  "code-reviewer": {
    description: "Expert code reviewer",
    prompt: "You are a code review specialist...",
    tools: ["Read", "Grep", "Glob"],  // 只读工具
    model: "sonnet",                   // 可用更小/便宜的模型
    effort: "low",                     // 降低推理深度
    maxTurns: 10,                      // 限制轮次
    background: true,                  // 非阻塞执行
    permissionMode: "dontAsk",         // 独立权限模式
  }
}
```

关键特性:
- **上下文隔离**: 子代理有独立对话，不污染主代理上下文
- **并行执行**: 多个子代理可同时运行
- **专业化指令**: 每个子代理有独立 system prompt
- **工具限制**: 每个子代理可用不同工具集
- **模型覆盖**: 子代理可用不同模型（如 haiku 做简单任务）
- **后台执行**: `background: true` 非阻塞
- **动态配置**: 运行时工厂函数创建不同配置的代理

#### 当前实现

- ❌ **完全未使用子代理**
- 所有任务在单个代理中执行
- 无法并行处理独立子任务
- 无法为不同任务使用不同模型
- 长对话上下文持续增长

#### 改进建议

1. **定义专业子代理**:
   ```typescript
   agents: {
     "code-reviewer": {
       description: "Code review specialist",
       prompt: "Review code for quality, security, and best practices",
       tools: ["Read", "Grep", "Glob"],
       model: "haiku",
       effort: "low"
     },
     "file-explorer": {
       description: "Find and analyze files",
       prompt: "Search and analyze file structures",
       tools: ["Read", "Glob", "Grep"],
       model: "haiku"
     }
   }
   ```
2. **后台代理**: 耗时任务（如大型项目分析）用 `background: true` 不阻塞主对话
3. **模型分层**: 简单任务用 haiku 降低成本，复杂任务用 sonnet/opus
4. **上下文管理**: 子代理自动隔离上下文，避免主对话过长触发 compaction

---

### 2.5 MCP 服务器 — 🔴 较大差距

#### SDK 官方能力

4种传输类型:
| 类型 | 适用场景 |
|------|---------|
| `stdio` | 本地进程 (npx command) |
| `sse` | 远程 SSE 端点 |
| `http` | 远程 HTTP 端点 |
| `sdk` | 进程内 MCP 服务器 |

运行时管理:
- `mcpServerStatus()` — 检查连接状态
- `reconnectMcpServer(name)` — 重连
- `toggleMcpServer(name, enabled)` — 启用/禁用
- `setMcpServers(servers)` — 动态替换服务器集

#### 当前实现

- ❌ **完全未使用 MCP 服务器**
- 无外部工具集成
- 无数据库/浏览器/API 连接
- 无法运行时管理 MCP 服务器

#### 改进建议

1. **文件系统 MCP**: 连接 `@modelcontextprotocol/server-filesystem` 提供更安全的文件访问
2. **GitHub MCP**: 连接 GitHub 服务器实现 PR/Issue 管理
3. **数据库 MCP**: 连接数据库服务器实现数据查询
4. **自定义 SDK MCP 服务器**: 用 `createSdkMcpServer()` + `tool()` 创建应用特定的工具（如 Electron API 封装）
5. **运行时管理**: 实现动态 MCP 服务器启停 UI

---

### 2.6 自定义工具 — 🔴 较大差距

#### SDK 官方能力

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const electronTool = tool(
  "open_dialog",
  "Open a native file dialog",
  { title: z.string(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })) },
  async (args) => {
    const result = await dialog.showOpenDialog({ title: args.title, filters: args.filters });
    return { content: [{ type: "text", text: JSON.stringify(result.filePaths) }] };
  },
  { annotations: { readOnlyHint: true } }
);

const electronServer = createSdkMcpServer({
  name: "electron",
  version: "1.0.0",
  tools: [electronTool]
});

// 在 query 中使用
query({ prompt: "...", options: {
  mcpServers: { electron: electronServer },
  allowedTools: ["mcp__electron__*"]
}})
```

#### 当前实现

- ❌ **完全未使用自定义工具**
- 所有 Electron API 调用都在主进程手动处理
- Agent 无法直接调用 Electron 功能（窗口管理、对话框、通知等）

#### 改进建议

创建 Electron API MCP 服务器，让 Agent 直接调用:
- `open_file_dialog` — 文件选择对话框
- `show_notification` — 系统通知
- `read_clipboard` / `write_clipboard` — 剪贴板
- `open_external` — 打开外部链接
- `take_screenshot` — 截图

---

### 2.7 流式输出 — 🟡 中等差距

#### SDK 官方能力

```typescript
for await (const message of query({
  prompt: "...",
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    if (message.event.type === "content_block_delta") {
      if (message.event.delta.type === "text_delta") {
        process.stdout.write(message.event.delta.text);
      }
    }
  }
}
```

还包括:
- `ttft_ms` — 首字节时间
- 工具调用流式输入（input_json_delta）
- 完整消息流：message_start → content_block_start → deltas → content_block_stop → message_stop

#### 当前实现

- ❌ **未使用 `includePartialMessages`**
- ✅ 自定义文本批次机制 (`agent-text-batch.ts`, 30ms 窗口)
- 文本增量通过 IPC 发送到渲染进程
- 但缺少结构化的流式事件类型

#### 改进建议

1. **启用 `includePartialMessages`**: 获取结构化的流式事件，而非自定义文本批次
2. **利用 `ttft_ms`**: 显示首字节延迟指标
3. **工具调用流式**: 实时显示工具输入参数的流式构建过程
4. **保留文本批次优化**: 在 IPC 层保留批次优化，但在 SDK 层使用官方流式 API

---

### 2.8 文件检查点 — 🟡 中等差距

#### SDK 官方能力

```typescript
const response = query({
  prompt: "Refactor the auth module",
  options: {
    enableFileCheckpointing: true,
    permissionMode: "acceptEdits",
    extraArgs: { "replay-user-messages": null }
  }
});

// 捕获检查点
let checkpointId;
for await (const message of response) {
  if (message.type === "user" && message.uuid) {
    checkpointId = message.uuid;
  }
}

// 回滚
await rewindQuery.rewindFiles(checkpointId);
```

#### 当前实现

- ❌ **完全未使用文件检查点**
- Agent 修改文件后无法撤销
- 用户只能通过 git 或手动恢复

#### 改进建议

1. **启用 `enableFileCheckpointing`**: 自动跟踪文件修改
2. **UI 集成**: 在 Agent 修改文件后显示"撤销更改"按钮
3. **多检查点**: 存储多个检查点，允许回滚到任意点
4. **dryRun 模式**: 预览回滚影响但不执行

---

### 2.9 成本追踪 — 🟡 中等差距

#### SDK 官方能力

```typescript
// 单次查询总成本
if (message.type === "result") {
  console.log(`Total cost: $${message.total_cost_usd}`);
}

// 每模型细分
for (const [model, usage] of Object.entries(message.modelUsage)) {
  console.log(`${model}: $${usage.costUSD}`);
  console.log(`  Cache read: ${usage.cacheReadInputTokens}`);
  console.log(`  Cache creation: ${usage.cacheCreationInputTokens}`);
}

// 每步追踪 (去重 by message.message.id)
if (message.type === "assistant") {
  if (!seenIds.has(message.message.id)) {
    seenIds.add(message.message.id);
    totalInputTokens += message.message.usage.input_tokens;
  }
}
```

#### 当前实现

- ✅ 提取 `total_cost_usd` 到 usageInfo
- ⚠️ 仅显示总量，无每模型细分
- ❌ 无缓存命中率分析
- ❌ 无每步追踪
- ❌ 无累计成本追踪

#### 改进建议

1. **显示 modelUsage 细分**: 不同模型（主代理 vs 子代理）分别显示成本
2. **缓存命中率**: 显示 `cacheReadInputTokens` 帮助优化上下文
3. **累计成本**: 跨多次查询追踪总花费
4. **成本预警**: 接近 `maxBudgetUsd` 时提醒用户

---

### 2.10 启动预热 — 🟡 中等差距

#### SDK 官方能力

```typescript
import { startup } from "@anthropic-ai/claude-agent-sdk";

// 提前预热子进程
const warm = await startup({ options: { maxTurns: 3 } });

// 用户发送消息时无需等待启动
for await (const message of warm.query("What files are here?")) {
  console.log(message);
}
```

#### 当前实现

- ❌ **未使用 `startup()`**
- 每次发送消息都要等待子进程启动和初始化
- 用户可感知的延迟

#### 改进建议

1. **应用启动时预热**: 在 Electron 主进程启动时调用 `startup()`，首次消息响应更快
2. **预热池**: 维护一个 `WarmQuery` 池，随时可用

---

### 2.11 结构化输出 — 🟡 中等差距

#### SDK 官方能力

```typescript
query({
  prompt: "Analyze this code and return a structured report",
  options: {
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          issues: { type: "array", items: { type: "string" } },
          score: { type: "number" }
        }
      }
    }
  }
})
```

结果在 `ResultMessage.structured_output` 中。

#### 当前实现

- ❌ **完全未使用结构化输出**
- 所有输出都是自由文本
- 无法保证输出格式

#### 改进建议

1. **Cron 任务**: 使用结构化输出确保任务结果格式一致
2. **代码审查**: 输出结构化的审查报告
3. **错误分类**: 结构化的错误诊断结果

---

### 2.12 系统提示词配置 — 🟢 基本匹配

#### SDK 官方能力

```typescript
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: 'Additional instructions...',
  excludeDynamicSections: true  // 将per-session上下文移到第一条用户消息，改善跨机器缓存
}
```

#### 当前实现

```typescript
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: profile.systemPromptAppend,
}
```

- ✅ 使用 preset + append
- ❌ **未使用 `excludeDynamicSections`** — 可能改善跨机器 prompt cache 命中率

---

### 2.13 Settings 管理 — 🟡 中等差距

#### SDK 官方能力

- `settingSources: ('user' | 'project' | 'local')[]` — 控制文件系统设置源
- `settings: string | Settings` — 内联设置或路径
- `resolveSettings()` — 预览有效设置
- `applyFlagSettings()` — 运行时修改设置

#### 当前实现

- ✅ 使用 `settingSources` 
- ❌ **未使用 `resolveSettings()`** — 无法预览有效配置
- ❌ **未使用 `applyFlagSettings()`** — 无法运行时修改设置
- ❌ **未使用 `settings` 内联选项** — 所有配置分散在多处

---

## 三、当前代码自己实现但 SDK 已有原生支持的功能

| # | 当前自己实现 | SDK 原生方案 | 优势 |
|---|-------------|-------------|------|
| 1 | 自定义 pending permission Map | SDK `canUseTool` + `suggestions` → `updatedPermissions` | 自动持久化权限规则 |
| 2 | 自定义 text batching (30ms) | SDK `includePartialMessages` + StreamEvent | 结构化流式事件，支持工具调用流 |
| 3 | 三重会话存储 | SDK `listSessions()` + `getSessionInfo()` | 单一数据源，无一致性问题 |
| 4 | IPC 手动消息转换 | SDK 消息类型直接序列化 | 减少转换层，更少 bug |
| 5 | 自定义 compaction session 过滤 | SDK `tagSession()` + 标签过滤 | 标准化分类方式 |
| 6 | 手动路径授权检查 | SDK `additionalDirectories` + `disallowedTools` | 声明式，更安全 |
| 7 | Cron 任务 acceptEdits + 手动路径检查 | SDK `permissionMode: 'dontAsk'` + `allowedTools` + `disallowedTools` | 更精确的控制 |
| 8 | 无文件撤销能力 | SDK `enableFileCheckpointing` + `rewindFiles()` | 安全网 |
| 9 | 无子代理 | SDK `agents` + `AgentDefinition` | 上下文隔离+并行+模型分层 |
| 10 | 无外部工具集成 | SDK MCP servers | 扩展能力边界 |
| 11 | 无自定义工具 | SDK `tool()` + `createSdkMcpServer()` | Agent 可调用 Electron API |
| 12 | 每次查询冷启动 | SDK `startup()` 预热 | 首次响应更快 |

---

## 四、优先级排序的行动计划

### P0 — 高价值、低成本 (立即可做)

| 行动 | 预期收益 | 工作量 |
|------|---------|--------|
| 启用 `includePartialMessages` | 更好的流式体验 | 小 |
| 添加 `disallowedTools` 到 cron | 安全性提升 | 极小 |
| 使用 `suggestions` + `updatedPermissions` | 减少重复权限提示 | 小 |
| 启用 `excludeDynamicSections: true` | 改善 prompt cache 命中率 | 极小 |
| 添加 `Stop` hook | Agent 完成时自动操作 | 小 |
| 添加 `UserPromptSubmit` hook | 自动注入编辑器上下文 | 中 |

### P1 — 高价值、中成本 (1-2周)

| 行动 | 预期收益 | 工作量 |
|------|---------|--------|
| 启用文件检查点 | 用户可撤销 Agent 修改 | 中 |
| 实现子代理支持 | 上下文隔离+并行+模型分层 | 中 |
| 创建 Electron API MCP 服务器 | Agent 可调用原生功能 | 中 |
| 统一会话存储 | 消除三重存储的不一致 | 中 |
| 添加 `plan` 模式 | 先分析再编辑的工作流 | 小 |

### P2 — 高价值、高成本 (长期规划)

| 行动 | 预期收益 | 工作量 |
|------|---------|--------|
| 实现外部 MCP 服务器集成 | GitHub/数据库/浏览器等 | 大 |
| 使用 `startup()` 预热 | 消除首次响应延迟 | 中 |
| 结构化输出 | 保证输出格式 | 中 |
| 运行时 MCP 管理 UI | 动态启停服务器 | 大 |
| SessionStore 适配器 | 多设备同步会话 | 大 |
| `forkSession` UI | 探索替代方案 | 中 |

---

## 五、SDK 功能对应应用拓展帮助

| SDK 功能 | 对 Vision Agent 的拓展方向 |
|---------|-------------------------|
| **Subagents** | 代码审查代理、文件搜索代理、测试运行代理 — 各司其职，并行执行 |
| **Custom Tools (SDK MCP)** | Electron API 工具包 — Agent 可直接打开对话框、管理窗口、截图、访问剪贴板 |
| **MCP Servers** | GitHub 集成 — Agent 可创建 PR、审查代码、管理 Issue |
| **File Checkpointing** | 安全编辑 — 每次修改前自动快照，支持一键回滚 |
| **Plan Mode** | 规划模式 — Agent 先分析代码结构、提出修改方案，用户确认后再执行 |
| **Streaming Output** | 实时流式渲染 — 显示打字效果、工具调用进度、思考过程 |
| **Structured Output** | 格式化输出 — 代码审查报告、项目分析结果、错误诊断 |
| **Startup Pre-warming** | 即时响应 — 应用启动时预初始化，用户发送首条消息无延迟 |
| **Session Tags** | 会话组织 — 按项目/类型/状态标签管理历史会话 |
| **Fork Session** | 方案对比 — 从同一会话分叉探索不同实现路径 |
| **Tool Aliases** | 自定义工具替换 — 用 MCP 实现替换内置 Bash/Read 等工具 |
| **Prompt Suggestions** | 智能建议 — Agent 完成后自动推荐下一步操作 |
| **applyFlagSettings** | 动态配置 — 运行时切换模型、权限、钩子等设置 |
| **Agent Progress Summaries** | 进度可视化 — 子代理执行时显示一行摘要 |

---

## 六、总结

当前 Vision Agent 对 Claude Agent SDK 的使用主要集中在核心 `query()` 函数和基础的会话/权限管理上。SDK 提供的大量高级功能（子代理、MCP、自定义工具、文件检查点、流式输出等）尚未利用。

**核心差距**: 
1. **子代理** — 最具架构影响力的缺失，直接影响上下文管理、成本优化和并行能力
2. **MCP + 自定义工具** — 最具功能拓展性的缺失，决定 Agent 能力的边界
3. **Hooks 深度** — 17/20 种 Hook 事件未使用，错失自动化和安全增强机会

**核心建议**: 优先实现 P0 项（低成本高收益），然后逐步引入子代理和 MCP 支持。这将从根本上提升应用的架构成熟度和功能边界。
