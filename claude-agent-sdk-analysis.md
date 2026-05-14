# Claude Agent SDK 深度分析

> 基于 [官方文档](https://code.claude.com/docs/en/agent-sdk/overview) 和 [GitHub 仓库](https://github.com/anthropics/claude-agent-sdk-typescript) 的完整分析

---

## 一、核心架构：SDK 是进程编排层，不是 Agent 实现

SDK 本质上是 **spawn 一个 Claude Code 原生二进制作为子进程**，通过 JSON stdin/stdout 协议通信。

- 所有 Agent 逻辑（工具循环、上下文管理、压缩）都由 CLI 子进程处理
- SDK 只是"遥控器"，负责配置、消息流、权限控制
- **好处**：不需要自己实现 tool loop、context compaction、session 管理 — 全部内置
- **代价**：依赖平台特定的原生二进制（Linux/macOS/Windows 各有），不是纯 JS/Python 实现

---

## 二、内置方案（Batteries Included）

以下功能 SDK 直接提供，不需要自己实现：

### 1. 内置工具（20+ 个，开箱即用）

| 工具 | 能力 |
|------|------|
| Read/Write/Edit | 文件读写编辑 |
| Bash | 执行命令、git 操作 |
| Glob/Grep | 文件搜索和内容搜索 |
| WebSearch/WebFetch | 网络搜索和抓取 |
| Agent | 子 agent 调度 |
| Monitor | 监控后台进程输出 |
| NotebookEdit | Jupyter notebook 编辑 |
| AskUserQuestion | 向用户提问（多选项） |
| TaskCreate/Get/Update/List | 任务管理系统 |
| EnterWorktree/ExitWorktree | Git worktree 管理 |

工具的输入输出都有完整的 Zod schema（`sdk-tools.d.ts`），可以直接引用类型。

### 2. 子 Agent 系统（内置，不需要自己写调度器）

- `AgentDefinition` 直接在 `agents` 参数中定义
- 支持：独立 prompt、工具限制、model 覆盖、MCP server、skills、effort 级别
- **背景模式**：`background: true` 可以异步执行
- **上下文隔离**：子 agent 有独立对话，只返回最终结果给父 agent
- **限制**：子 agent 不能再 spawn 子 agent（不能嵌套）

### 3. Hooks 系统（29 种事件类型）

- `PreToolUse/PostToolUse` — 工具调用前后拦截
- `SubagentStart/SubagentStop` — 子 agent 生命周期
- `SessionStart/SessionEnd` — 会话管理
- `Notification` — 状态通知（可转发到 Slack 等）
- **关键能力**：可以 block/deny/allow/modify tool input/replace tool output
- **异步模式**：`async: true` 让 hook 不阻塞 agent 执行

### 4. Session 管理（内置持久化）

- 自动写入 JSONL 到 `~/.claude/projects/<encoded-cwd>/`
- `resume` / `continue` / `forkSession` 三种恢复模式
- `SessionStore` 接口支持外部存储（S3、Redis、Postgres 有参考实现）
- `persistSession: false` 可禁用磁盘写入（TS only）

### 5. MCP 集成（三种传输方式）

- **stdio**：本地进程（`npx @modelcontextprotocol/server-github`）
- **HTTP/SSE**：远程 API
- **SDK MCP Server**：进程内自定义工具（`createSdkMcpServer` + `tool()`）

### 6. 自定义工具（进程内 MCP Server）

```typescript
const myTool = tool("name", "description", { param: z.string() }, async (args) => {
  return { content: [{ type: "text", text: "result" }] }
})
const server = createSdkMcpServer({ name: "my-tools", tools: [myTool] })
```

- 支持 Zod schema 自动类型推导
- 支持返回图片（base64）、资源块、结构化 JSON（`structuredContent`）
- 工具命名：`mcp__<server_name>__<tool_name>`

### 7. Tool Search（默认开启）

- 大量工具时自动按需加载，不占满 context window
- 最多支持 10,000 个工具
- 搜索返回 3-5 个最相关的工具
- 需要 Sonnet 4+ 或 Opus 4+（不支持 Haiku）

### 8. 权限系统（6 种模式）

| 模式 | 行为 |
|------|------|
| default | 未匹配的触发 canUseTool |
| dontAsk | 未预批准的直接拒绝 |
| acceptEdits | 自动批准文件编辑 |
| bypassPermissions | 全部自动批准（危险） |
| plan | 只允许只读工具 |
| auto | 模型分类器决定（TS only） |

### 9. 其他内置能力

- **Warm startup**：`startup()` 预热子进程，首次查询快 ~20x
- **Structured output**：`outputFormat: { type: 'json_schema', schema: {...} }`
- **File checkpointing**：`enableFileCheckpointing` + `rewindFiles()` 文件撤销
- **Prompt caching**：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 分割静态/动态部分
- **OpenTelemetry**：自动 trace context 传播
- **Browser transport**：WebSocket 连接，支持浏览器环境
- **Bridge/Assistant mode**：claude.ai 集成和 daemon 模式
- **Remote Control**：VS Code 风格远程会话
- **Memory system**：自动记忆召回
- **Adaptive thinking**：`thinking: { type: 'adaptive' }`（Opus 4.6+）

---

## 三、需要注意的限制

1. **子 agent 不能嵌套** — 只能一层子 agent，不能子 agent 再 spawn 子 agent
2. **依赖原生二进制** — 不是纯 JS，部署需要平台对应的 binary
3. **子 agent 不继承父对话** — 只有 prompt string 传递信息，需要把所有必要信息写在 prompt 里
4. **Python SDK 功能略少** — SessionStart/SessionEnd 等只在 TS SDK 有回调 hook
5. **bypassPermissions + allowedTools 不互斥** — allowedTools 在 bypassPermissions 下不限制，需要用 disallowedTools
6. **独立 credit 限制** — Agent SDK 使用会消耗单独的月度额度

---

## 四、对 Vision Agent 应用的建议

| 需求 | 推荐方案 |
|------|----------|
| 核心 agent loop | 直接用 `query()`，不需要自己实现 |
| 视觉相关工具 | 用 `createSdkMcpServer` 定义进程内 MCP 工具（截图、OCR、视频处理等） |
| 多步骤任务 | 用 `agents` 定义专门的子 agent（分析 agent、执行 agent 等） |
| 权限控制 | 用 `acceptEdits` + `allowedTools` + hooks 组合 |
| 会话管理 | 用 `continue: true` 或 `resume` 实现多轮对话 |
| Tool loop | 不需要自己写 — SDK 内置 |
| Context compaction | 不需要自己写 — SDK 内置 |
| Session storage | 不需要自己写 — SDK 内置 |
| Permission flow | 不需要自己写 — SDK 内置 |
