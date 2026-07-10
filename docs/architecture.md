# 当前架构

本文描述当前代码，不是规划稿。模块边界发生变化时应同步更新。

## 进程边界

```mermaid
flowchart LR
  R[Renderer / React] -->|window.api| P[Preload / contextBridge]
  P -->|invoke + events| M[Electron Main]
  M --> SDK[Claude Agent SDK]
  M --> FS[Workspace / session files]
  M --> Store[electron-store]
  M --> OS[Notifications / updater / shell]
```

BrowserWindow 在 `src/main/index.ts` 中创建，启用 sandbox、context isolation 和 web security，关闭 Node integration。主进程是文件系统、SDK、通知、更新与持久化的信任边界。

## Main

### 启动层

`src/main/index.ts` 负责：

- 配置应用身份和 Sentry
- 迁移 electron-store
- 注册 IPC
- 初始化知识库和文件索引
- 同步内置 Skills
- 恢复持久化 Cron 任务
- 创建窗口并配置外链、更新和退出清理

### IPC 层

`src/main/ipc-handlers.ts` 只负责顶层注册。实际处理器按领域拆在 `src/main/handlers/`：workspace、editor、settings、agent、memory、graph、cron、skills、attachments、search、notification 和 connection。

`src/shared/ipc-types.ts` 定义请求、响应和推送事件；`src/preload/index.ts` 将其适配成 `window.api`。新增 IPC 时必须同时维护这两个边界和 renderer 类型。

### Agent 层

- `query-runner.ts`：准备会话目录、构建 prompt/options、执行 `query()`、消费 SDK 流
- `agent-options.ts`：模型 Profile、环境变量白名单、Claude CLI 路径、SDK Options
- `session-runtime.ts`：活跃运行注册、AbortController、权限/AskUser、文本批次、实时生成活动和会话事件
- `generation-activity-projector.ts`：将 SDK 内容块和工具输入流投影为会话级生成活动；Renderer 不接触 SDK 原始事件
- `message-converter.ts`：SDK 消息转换为 renderer 使用的消息协议
- `session-store.ts`：SDK 会话列表、历史分页、重命名、删除及 compaction 过滤
- `session-persistence-adapter.ts`：SDK 会话 materialization 与 app session 元数据之间的桥接
- `inline-rewrite-runner.ts`：编辑器选区的临时 AI 改写；打开提示框时预热一次性 SDK 进程，提交后执行低推理强度的单轮纯 Markdown 改写；禁用工具与 transcript 持久化，可按 request ID 取消

`agent-manager.ts` 只是兼容导出层，不是实现中心。

### 文件与授权

每个 workspace session 使用独立的 `.sumi/sessions/<hash>/` 工作目录。`session-file-access.ts` 根据工作目录、内置 Skill 目录、附件授权和用户显式路径决定工具访问；renderer 提供的路径不能直接作为授权依据。

`session-file-catalog.ts` 从受管会话目录实时发现产物，不维护另一份 artifact 数据库。

### 持久化

共享的 electron-store 实例位于 `persistence/store-core.ts`：

- `profile-store.ts`：Profile、API Key、模型和服务地址
- `workspace-store.ts`：授权目录、workspace、app session 元数据、知识库
- `settings-store.ts`：主题、Cron、Skill 开关和 compaction IDs

Claude SDK JSONL 是对话 transcript 的来源；electron-store 保存产品级映射和展示元数据。两者职责不同。

### 搜索、图谱与 Skills

`file-index-service.ts` 为工作区提供全文搜索，并为知识库维护文件节点与 wikilink 引用图。Renderer 使用 `react-force-graph-2d` 显示图谱。

内置 Skill 由 manifest 驱动并在启动时安装到应用自己的 Claude 配置目录。Workspace 通过轻量链接发现这些 Skills。社区 Skill 通过受控 catalog 安装、更新和卸载。

## Renderer

Renderer 是单页 React 应用：

- `App.tsx`：主题、设置缓存、更新订阅和全局 provider
- `AppShell.tsx`：Workspace、编辑器、Agent panel、搜索和图谱编排
- `agent-store*`：按 context 与 session 隔离的流式状态
- `ui-slice.ts`：非 Agent UI 状态
- `useAgent.ts`：唯一 IPC 订阅入口和 Agent actions
- `MarkdownEditor.tsx`：Tiptap Markdown 编辑、自动保存及选区级 AI 改写审阅
- `AssistantMarkdown.tsx`：Streamdown + Shiki + KaTeX + Mermaid

React 组件错误由 ErrorBoundary 隔离；全局同步错误和未处理 Promise 使用可关闭 banner，不创建阻断式全屏遮罩。

行内 AI 改写通过 ProseMirror decoration 显示原文删除线和 Markdown 建议，只有 Accept 才产生文档 transaction 并进入自动保存；Undo/取消不会修改文件。

## 打包

Renderer 依赖由 Vite 打入静态资源；只有 main/preload 运行时依赖保留在生产 `node_modules`。Claude 原生二进制及 CLI 相关文件通过 `asarUnpack` 放入 `app.asar.unpacked`。Skills 作为 `extraResources` 打包并在 pack/dist 后校验。

当前 macOS 构建目标为 arm64 DMG/ZIP，签名、hardened runtime 和 notarization 尚未开启。
