# Vision Agent 实现计划

> 基于当前代码状态（1702 行）和 ROADMAP.md，制定细粒度分步计划
> 每步完成后自测或提示用户测试，用户决定是否继续下一步

---

## 当前已完成状态

| 模块 | 状态 |
|------|------|
| Electron 脚手架 | ✅ 完成 |
| 三栏布局（侧栏+编辑区+Agent面板） | ✅ 完成 |
| Markdown 编辑器（Tiptap） | ✅ 基础完成 |
| Agent SDK 集成（agent-manager.ts） | ✅ 基础完成（query + canUseTool） |
| 聊天 UI（消息气泡+工具调用展示） | ✅ 基础完成 |
| 设置页面（Profile+授权目录） | ✅ 完成 |
| IPC 通道（preload+ipc-handlers） | ✅ 完成 |
| Zustand store | ✅ 基础完成 |
| Notion 风格 CSS | ✅ 基础完成 |

---

## Phase 1：Agent 核心能力完善（6 步）

### 1.1 迁移到 @anthropic-ai/claude-agent-sdk 正式包

**目标**：从 `@anthropic-ai/claude-code/sdk` 迁移到正式的 `@anthropic-ai/claude-agent-sdk`

**改动**：
- `package.json`：移除 `@anthropic-ai/claude-code` 和 `@anthropic-ai/claude-code-darwin-arm64`，添加 `@anthropic-ai/claude-agent-sdk`
- `agent-manager.ts`：import 从 `@anthropic-ai/claude-code/sdk` 改为 `@anthropic-ai/claude-agent-sdk`
- `electron.vite.config.ts`：移除 `copyClaudeCodePlugin` 和相关 alias，更新 externalizeDepsPlugin exclude 列表
- 类型引用更新：`Options`, `SDKMessage`, `PermissionResult` 等从新包导入

**验证**：`npm run dev` 能启动，Agent 能正常对话

---

### 1.2 Agent 消息流优化 — 正确处理 SDK 消息类型

**目标**：当前 `useAgent.ts` 的 `handleAgentMessage` 只粗略处理 `assistant` 和 `result` 类型，需要完整处理 SDK 的消息类型体系

**改动**：
- `agent-store.ts`：扩展 `ChatMessage` 类型，增加 `toolResult` 字段存储工具结果
- `useAgent.ts`：完整处理 SDK 消息类型：
  - `type: 'assistant'` → 提取 text + tool_use blocks
  - `type: 'result'` → 提取最终结果、session_id、费用信息
  - `type: 'system'` → 提取 init 信息（session_id、工具列表、MCP 状态）
  - `type: 'status'` → 处理 compacting/requesting 状态
  - 工具结果：当 tool_use 后收到对应结果时，更新 ToolCall 的 result 和 status
- `ipc.ts`：扩展 `AgentMessageData` 类型

**验证**：聊天面板能正确显示：文字消息、工具调用（带结果）、流式状态

---

### 1.3 权限系统 — UI 弹窗审批

**目标**：当前 `canUseTool` 直接在主进程自动判断，用户无法交互审批。需要把权限请求推到渲染进程，让用户在 UI 中审批

**改动**：
- `agent-manager.ts`：`canUseTool` 回调改为：发送 IPC 事件到渲染进程，等待用户响应
- `ipc-handlers.ts`：新增 `agent:permissionRequest`（主→渲染）和 `agent:permissionResponse`（渲染→主）通道
- `preload/index.ts`：新增权限相关 IPC 方法
- `ipc.ts`：新增 `PermissionApi` 类型定义
- 新组件 `PermissionDialog.tsx`：弹窗显示工具名、参数摘要，提供 Allow / Deny / Always Allow 按钮
- `useAgent.ts`：监听权限请求事件，弹出 PermissionDialog

**验证**：Agent 尝试执行 Bash 命令时，UI 弹出审批弹窗；用户点击 Allow 后命令执行

---

### 1.4 会话管理 — 恢复、列表、新建

**目标**：当前 session 只在内存 Map 中跟踪，没有持久化恢复能力。利用 SDK 内置的 session 持久化实现完整会话管理

**改动**：
- `agent-manager.ts`：
  - `sendMessage` 支持 `resume` 参数恢复已有 session
  - 新增 `continueConversation()` 使用 `continue: true` 恢复最近 session
  - 新增 `listSessions()` 调用 SDK 的 `listSessions()` 函数
  - 新增 `getSessionMessages()` 调用 SDK 的 `getSessionMessages()`
- `ipc-handlers.ts`：新增会话相关 IPC handlers
- `preload/index.ts`：新增会话 IPC 方法
- `ipc.ts`：扩展 `AgentApi` 类型
- `agent-store.ts`：新增会话列表状态
- `useAgent.ts`：新增会话管理方法
- `Sidebar.tsx`：底部新增"会话历史"区域，显示最近会话列表，点击恢复

**验证**：关闭应用后重新打开，能恢复之前的对话上下文

---

### 1.5 Hooks 集成 — 安全拦截 + 审计日志

**目标**：利用 SDK hooks 系统实现：1) 拦截未授权目录操作 2) 审计日志 3) 通知推送

**改动**：
- `agent-manager.ts`：
  - `buildOptions()` 中添加 `hooks` 配置
  - `PreToolUse` hook：拦截授权目录外的文件操作（替代当前 canUseTool 中的路径检查）
  - `PostToolUse` hook：记录工具调用到审计日志（写入 `.vision/audit.jsonl`）
  - `Notification` hook：转发状态通知到渲染进程
- 移除 `canUseTool` 中的路径检查逻辑（由 PreToolUse hook 替代）
- `ipc-handlers.ts`：新增 `agent:notification` IPC 通道
- `preload/index.ts` + `ipc.ts`：新增通知 API
- `useAgent.ts`：监听通知事件

**验证**：Agent 尝试操作授权目录外的文件时被拦截；工具调用记录写入审计日志

---

### 1.6 Agent 状态展示 — 进度指示 + 费用统计

**目标**：在 Agent 面板中显示实时状态和费用信息

**改动**：
- `agent-store.ts`：新增 `agentStatus`（idle/thinking/running/comacting）和 `usageInfo`（tokens/cost）字段
- `useAgent.ts`：处理 `type: 'status'` 消息更新状态，处理 `type: 'result'` 提取费用
- `AgentPanel.tsx`：header 区域新增状态指示器（spinner + 状态文字）和费用显示
- `chat.css`：新增状态指示器样式

**验证**：Agent 运行时面板显示"Thinking..."或"Running tool..."状态；完成后显示费用

---

## Phase 2：Markdown 编辑器完善（4 步）

### 2.1 编辑器增强 — 代码高亮 + 表格 + 任务列表

**目标**：Tiptap 编辑器支持完整的 Markdown 体验

**改动**：
- `package.json`：添加 `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`, `@tiptap/extension-highlight`, `@tiptap/extension-typography`
- `MarkdownEditor.tsx`：注册新扩展，完善编辑器配置
- `editor.css`：新增表格、任务列表、高亮样式

**验证**：编辑器能正确渲染和编辑：代码块（带语法高亮）、表格、任务列表、高亮文本

---

### 2.2 双向链接语法 — `[[链接]]` 解析 + 自动补全

**目标**：支持 Obsidian 风格的 `[[链接]]` 语法

**改动**：
- 新建 `src/renderer/extensions/wikilink.ts`：Tiptap 自定义 extension，解析 `[[text]]` 为可点击链接节点
- 新建 `src/renderer/extensions/wikilink-suggestion.ts`：自动补全 suggestion，输入 `[[` 时弹出文件列表
- `MarkdownEditor.tsx`：注册 wikilink extension
- `agent-store.ts` 或新建 `workspace-store.ts`：维护当前 workspace 的文件列表供补全使用
- `editor.css`：wikilink 样式（蓝色高亮、点击跳转）

**验证**：输入 `[[` 弹出文件列表；点击 `[[文件名]]` 在编辑器中打开对应文件

---

### 2.3 编辑器 ↔ Agent 联动

**目标**：选中编辑器文本后，可以右键发送给 Agent 分析；Agent 编辑结果自动同步到编辑器

**改动**：
- `MarkdownEditor.tsx`：新增右键菜单（"Ask Agent about this"/"Fix with Agent"）
- `AppShell.tsx`：新增 `handleAskAgent(selection, filePath)` 方法
- `useAgent.ts`：新增 `askWithContext(prompt, context)` 方法，在 prompt 中附加选区上下文
- `ChatInput.tsx`：支持预填充 prompt（从编辑器右键菜单传入）
- 当 Agent 使用 Edit/Write 工具修改当前打开的文件时，编辑器自动刷新内容

**验证**：在编辑器中选中一段代码，右键"Ask Agent"，Agent 面板收到带上下文的 prompt

---

### 2.4 文件自动保存 + 多标签页

**目标**：编辑器支持自动保存和同时打开多个文件

**改动**：
- `AppShell.tsx`：新增 `openFiles` 状态（数组），支持多文件切换
- 新建 `src/renderer/components/editor/EditorTabs.tsx`：标签页栏组件
- `MarkdownEditor.tsx`：添加 debounce 自动保存（2秒无操作后保存）
- `agent-store.ts`：新增 `currentFilePath` 状态
- `layout.css`：新增标签页样式

**验证**：打开多个文件时顶部显示标签页；切换标签页保留各文件内容；编辑后自动保存

---

## Phase 3：记忆系统 + 图谱（5 步）

### 3.1 记忆系统 — 目录结构 + Agent 自动读写

**目标**：实现 `.vision/memory/` 目录结构，Agent 通过内置工具自动读写记忆

**改动**：
- `agent-manager.ts`：
  - `buildOptions()` 中设置 `cwd` 为授权目录
  - 在 system prompt 中添加记忆系统说明（通过 `systemPrompt` 选项）
  - Agent 可以用 Read/Write/Edit 工具操作 `.vision/memory/` 目录
- `ipc-handlers.ts`：新增 `memory:list`、`memory:read`、`memory:write` IPC
- `preload/index.ts` + `ipc.ts`：新增 MemoryApi
- 新建 `src/renderer/components/sidebar/MemoryPanel.tsx`：侧栏记忆面板
- `Sidebar.tsx`：新增记忆面板区域

**验证**：告诉 Agent "记住我喜欢用 TypeScript"，Agent 写入 `.vision/memory/` 目录；下次对话 Agent 自动读取记忆

---

### 3.2 记忆 UI — 查看/编辑/删除

**目标**：用户可以在侧栏中查看和编辑记忆文件

**改动**：
- `MemoryPanel.tsx`：显示记忆文件列表，点击打开到编辑器
- 记忆文件就是 Markdown，用现有编辑器直接编辑
- 新增删除记忆按钮

**验证**：侧栏显示记忆列表；点击记忆文件在编辑器中打开编辑

---

### 3.3 图谱数据层 — 从 `[[链接]]` 构建图结构

**目标**：解析 workspace 中所有 Markdown 文件的 `[[链接]]`，构建文档引用关系图

**改动**：
- 新建 `src/main/graph-builder.ts`：
  - 扫描授权目录下所有 `.md` 文件
  - 解析每个文件中的 `[[链接]]` 语法
  - 构建节点（文件）和边（链接关系）的图数据结构
  - 增量更新：文件变更时只重新解析变更文件
- `ipc-handlers.ts`：新增 `graph:getData` IPC
- `preload/index.ts` + `ipc.ts`：新增 GraphApi

**验证**：创建几个带 `[[链接]]` 的 Markdown 文件，调用 `graph:getData` 返回正确的图结构

---

### 3.4 图谱可视化 — D3.js force-directed graph

**目标**：在独立面板中渲染文档关系图谱

**改动**：
- `package.json`：添加 `d3` 和 `@types/d3`
- 新建 `src/renderer/components/graph/GraphView.tsx`：D3 force-directed graph 组件
  - 节点 = 文档（显示文件名）
  - 边 = 链接关系
  - 点击节点跳转到文档
  - 搜索过滤、节点高亮、邻居展开
- `AppShell.tsx`：新增图谱面板切换（侧栏新增"图谱"入口）
- 新建 `src/renderer/styles/graph.css`

**验证**：打开图谱面板，显示文档关系图；点击节点跳转到编辑器

---

### 3.5 图谱交互优化

**目标**：图谱的搜索、过滤、缩放等交互

**改动**：
- `GraphView.tsx`：
  - 搜索框：输入关键词高亮匹配节点
  - 缩放平移：D3 zoom behavior
  - 邻居展开：点击节点时展开其邻居
  - 颜色编码：按文件修改时间或链接数量区分

**验证**：图谱中搜索关键词能高亮节点；缩放平移流畅

---

## Phase 4：调度 + Skill + MCP（5 步）

### 4.1 Cron 调度 — 自然语言解析 + 任务注册

**目标**：用户用自然语言描述定时任务，Agent 解析并注册

**改动**：
- `package.json`：添加 `node-cron`
- 新建 `src/main/cron-manager.ts`：
  - 维护 cron 调度表（Map<taskId, cronJob>）
  - `registerTask(cronExpression, prompt, options)` 注册任务
  - `removeTask(taskId)` 删除任务
  - `listTasks()` 列出所有任务
  - 任务触发时调用 `query()` 执行
- `agent-manager.ts`：
  - 新增自定义 MCP 工具 `cron_register`、`cron_remove`、`cron_list`
  - 用 `createSdkMcpServer` 创建进程内 MCP server
- `ipc-handlers.ts`：新增 cron 相关 IPC
- `preload/index.ts` + `ipc.ts`：新增 CronApi

**验证**：告诉 Agent "每天早上9点总结日记"，Agent 解析并注册 cron 任务

---

### 4.2 调度 UI — 任务列表 + 状态监控

**目标**：在侧栏中显示定时任务列表和执行状态

**改动**：
- 新建 `src/renderer/components/sidebar/CronPanel.tsx`：
  - 任务列表（名称、cron 表达式、状态）
  - 手动触发按钮
  - 删除按钮
  - 执行历史（最近5次结果摘要）
- `Sidebar.tsx`：新增 Cron 面板入口

**验证**：侧栏显示已注册的 cron 任务；手动触发能执行

---

### 4.3 Skill 发现 + 运行

**目标**：扫描 `.claude/skills/` 目录，列出可用 Skill，聊天中 `/skill-name` 触发

**改动**：
- `agent-manager.ts`：
  - `buildOptions()` 中启用 `settingSources: ['project', 'local']`
  - Agent 自动加载 `.claude/skills/` 下的 Skill
- `ipc-handlers.ts`：新增 `skills:list` IPC（扫描 skills 目录）
- 新建 `src/renderer/components/sidebar/SkillPanel.tsx`：显示可用 Skill 列表
- `ChatInput.tsx`：检测 `/` 开头的输入，弹出 Skill 补全列表
- `Sidebar.tsx`：新增 Skill 面板入口

**验证**：在 workspace 中放置一个 Skill 文件，侧栏显示该 Skill；输入 `/skill-name` 触发执行

---

### 4.4 MCP Server 管理 — 配置 + 连接

**目标**：用户可以在设置中配置 MCP Server（如 Playwright、GitHub 等）

**改动**：
- `store.ts`：新增 `mcpServers` 字段到 AppSettings
- `SettingsModal.tsx`：新增 MCP Server 配置区域（添加/删除 stdio/http server）
- `agent-manager.ts`：
  - `buildOptions()` 中读取 `mcpServers` 配置传入 `mcpServers` 选项
  - `allowedTools` 中添加 MCP 工具的 wildcard（`mcp__<name>__*`）
- `ipc-handlers.ts`：新增 MCP 相关 IPC
- `preload/index.ts` + `ipc.ts`：新增 MCP 配置 API

**验证**：在设置中添加 Playwright MCP Server，Agent 能使用浏览器操作工具

---

### 4.5 通知系统

**目标**：Cron 任务完成通知、Agent 状态通知

**改动**：
- 新建 `src/main/notification-manager.ts`：
  - 使用 Electron `Notification` API 发送系统通知
  - Cron 任务完成时发送通知
  - Agent 长时间空闲时发送通知
- `agent-manager.ts`：在 `Notification` hook 中调用通知管理器
- `ipc-handlers.ts`：新增通知相关 IPC

**验证**：Cron 任务完成后收到 macOS 系统通知

---

## Phase 5：打磨 + 高级功能（4 步）

### 5.1 暗色主题

**目标**：Notion 风格明暗切换

**改动**：
- `global.css`：新增 `[data-theme="dark"]` 变量集
- `AppShell.tsx`：新增主题切换按钮
- `store.ts`：新增 `theme` 字段
- 所有 CSS 文件：确保暗色变量覆盖

**验证**：切换暗色主题后所有界面元素正确显示

---

### 5.2 全局搜索

**目标**：跨文档全文搜索

**改动**：
- 新建 `src/renderer/components/search/SearchModal.tsx`：
  - Cmd+K 快捷键触发
  - 输入关键词，调用 `Grep` 工具搜索
  - 显示搜索结果列表，点击跳转到文件
- `AppShell.tsx`：注册快捷键

**验证**：Cmd+K 弹出搜索框；搜索关键词返回匹配文件列表

---

### 5.3 性能优化

**目标**：大文件虚拟滚动、Agent 响应缓存

**改动**：
- `ChatView.tsx`：消息列表虚拟滚动（超过100条时）
- `MarkdownEditor.tsx`：大文件性能优化
- `agent-manager.ts`：`startup()` 预热 CLI 子进程

**验证**：1000+ 条消息时聊天面板流畅滚动

---

### 5.4 macOS 打包 + 自动更新

**目标**：可分发的 macOS 应用

**改动**：
- `package.json`：添加 `electron-updater`
- `electron-builder.yml`：完善 macOS DMG 配置、签名
- 新建 `src/main/updater.ts`：自动更新检查逻辑
- `index.ts`：注册更新检查

**验证**：`npm run dist` 生成可安装的 DMG

---

## 执行原则

1. **每步独立可测**：每步完成后自测通过，告知用户结论或提示测试
2. **界面设计先 mockup**：涉及新 UI 时先给 ASCII mockup，用户评估后决定是否继续
3. **自行提交代码**：每步完成后自动 git commit
4. **依赖 SDK 内置能力**：优先使用 SDK 的 hooks、session、MCP、permission 等内置方案，不自己重新实现
5. **增量开发**：每步只改必要的文件，不超前实现