# Session Runtime Architecture

本文记录当前会话身份、并发执行和事件路由约束。

## 两类入口

- `ask`：应用级 Ask sumi 会话
- `editor`：绑定具体 workspace 的会话

多个会话可以并行运行。切换当前 workspace 或会话时，后台会话的消息、权限请求、AskUser、Skill 输出和完成状态仍必须回到原会话。

## 身份模型

跨进程事件使用 `AgentSessionEnvelope`：

```ts
type AgentSessionEnvelope = {
  context: 'editor' | 'ask'
  sessionId: string
  clientSessionKey: string
  sdkSessionId?: string
  workspacePath: string
}
```

- `sessionId` / `clientSessionKey`：应用拥有的稳定路由 ID
- `sdkSessionId`：Claude SDK 在首次 materialization 后产生的 transcript ID
- `workspacePath`：会话所属 workspace；会话生命周期内不得漂移
- `context`：UI 入口类型，不足以单独标识会话

所有 session-affecting 事件必须按 app session ID 路由，不能根据当前可见面板猜测归属。

## 执行流程

1. Renderer 为新对话创建临时 app session key，并乐观写入用户消息。
2. Main 的 `query-runner.ts` 根据 context 创建受管 working directory。
3. App session 元数据先写入 electron-store。
4. `query()` 启动后，`SessionRuntimeController.registerRun()` 以 app session ID 注册 Query、AbortController 和 envelope。
5. SDK 首次返回 `session_id` 时，runtime 将其附加为 `sdkSessionId`，但不改变 app session ID。
6. 每条 SDK 消息统一经过 `sessionRuntime.emitSdkMessage()`：Skill bridge、文本批次或消息转换，然后附带 envelope 发往 renderer。
7. Renderer 根据 envelope 更新 live slot 或后台 `sessionSlots[sessionId]`。
8. 结束时 runtime flush 文本、清理 Skill 状态、pending requests 和 active run。

## Working directory

Workspace 会话：

```text
<workspace>/.sumi/sessions/<sha256(app-session-id)[0..24]>/
```

Ask 会话：

```text
<app-data>/.sumi/ask-sessions/<sha256(app-session-id)[0..24]>/
```

SDK 的 `cwd` 和会话 transcript 查询都绑定到该 working directory。生成产物通过扫描该目录获得，不存在独立的 artifact store。

## SessionRuntimeController

`src/main/session-runtime.ts` 拥有：

- 活跃 Query 和 AbortController，按 app session ID 注册
- app ID / SDK ID / context alias 查找
- SDK session materialization
- 文本 delta 批处理、flush 和丢弃
- GenerationActivityProjector 生命周期
- 权限与 AskUser pending Promise、五分钟超时和 abort 清理
- session-scoped abort 与 completion 等待
- 带 envelope 的 main-to-renderer 事件

它不拥有：

- SDK options 和 system prompt：`agent-options.ts` / `query-runner.ts`
- 持久化 session metadata：`persistence/workspace-store.ts`
- SDK transcript 查询：`session-store.ts`
- Renderer 状态：`agent-store*`
- 产物数据库：当前不存在，文件目录就是事实来源

## Event protocol

以下事件必须携带 envelope：

- `agent:event`
- `agent:sessionCreated`
- `agent:sessionFilesChanged`
- `agent:permissionRequest`
- `agent:permissionTimeout`
- `agent:askUser`
- `agent:askUserTimeout`
- session-scoped `agent:notification`
- `agent:generationActivity`

App-level 通知（例如 Cron 失败）可以使用不带 session ownership 的 general notification。

Agent IPC 请求使用 `src/shared/ipc-types.ts` 中定义的对象 payload；Main、preload 与 Renderer 必须共同维护同一 interface。

## 权限与用户输入

`canUseTool` 先执行 session 文件访问判断：

- 会话 working directory 内的允许操作可自动通过
- 内置 Skill 资源和本次消息显式授权的附件/外部路径按规则处理
- 其他工具进入 renderer 审批队列
- `AskUserQuestion` 使用独立的 AskUser 队列

Renderer 回复必须携带 request ID；runtime 根据注册信息找到原 session。超时或 abort 会清理 pending Promise，避免后续响应串到其他会话。

## Transcript 与产品元数据

Claude SDK JSONL 保存 transcript。electron-store `SessionRecord` 保存：

- app session ID 与 SDK session ID 映射
- workspace/context/working directory
- 标题、摘要、标签、时间和消息计数

`session-store.ts` 按 working directory 调用 SDK API；历史分页优先直接读取 JSONL 尾部，以保留 compaction 前消息。SDK compaction 产生的内部 session ID 会持久化过滤，不作为独立用户会话展示。

## Renderer invariants

1. `slots.editor` 和 `slots.ask` 只表示当前可见 context。
2. `sessionSlots` 保存每个会话的隔离状态；后台事件只更新对应 entry。
3. Session materialization 只合并临时 app slot 和 SDK 信息，不重命名 app session key。
4. 权限、AskUser 和 Skill 输出按 request/session ID 路由。
5. IPC 静默只能触发非阻断提示，不能作为自动 abort 的依据。
6. 新查询替换旧查询时必须等待旧 runtime 的 finally 完成，避免旧清理删除新状态。

## 修改检查表

新增会话功能时确认：

- payload 是否进入 `IPCChannelMap`
- session-affecting event 是否带 envelope
- 后台 session 是否不会修改当前 live slot
- app session ID 和 SDK session ID 是否保持分工
- abort、窗口关闭和超时是否清理资源
- transcript、产品 metadata 和生成文件的权威来源是否明确
- 是否增加了跨会话/竞态回归测试
