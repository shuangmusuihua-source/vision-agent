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
  sdkSessionId?: string
  workspacePath: string
}
```

- `sessionId`：应用拥有的稳定路由 ID
- `sdkSessionId`：Claude SDK 在首次 materialization 后产生的 transcript ID
- `workspacePath`：会话所属 workspace；会话生命周期内不得漂移
- `context`：UI 入口类型，不足以单独标识会话

所有 session-affecting 事件必须按 app session ID 路由，不能根据当前可见面板猜测归属。

## 执行流程

1. Renderer 为新对话创建临时 app session ID，并乐观写入用户消息；发送请求只携带该 ID，不携带 SDK transcript ID。
2. Main 根据 app session ID 从 `SessionRecord` 解析 SDK transcript ID，再获取启动所有权；同一会话的启动串行，不同会话仍可并行。
3. `query-runner.ts` 在启动所有权内校验身份、终止并等待旧 run、准备受管 working directory。
4. App session 元数据先写入 electron-store。
5. `query()` 启动后，`SessionRuntimeController.registerRun()` 以 app session ID 注册 Query、AbortController 和 envelope；注册完成才释放启动所有权。
6. SDK 首次返回 `session_id` 时，runtime 将其附加为 `sdkSessionId`，但不改变 app session ID。
7. 每条 SDK 消息统一经过 `sessionRuntime.emitSdkMessage()`：Skill bridge、文本批次或消息转换，然后附带 envelope 发往 renderer。
8. Renderer 根据 envelope 更新 live slot 或后台 `sessionSlots[sessionId]`。
9. 结束时 runtime flush 文本、清理 Skill 状态、pending requests 和 active run。

启动所有权在 active run 注册后立即释放，不覆盖 SDK 流执行期；因此不同会话始终可以并行，同一会话的下一次启动也可以进入 abort-and-wait 来替换当前 run。

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
- workspace-scoped abort 与 completion 等待；工作区删除必须等待该 workspace 的所有 run 结束
- 按 app session ID 隔离的启动所有权；封装 abort / prepare / register 的有序 seam
- 带 envelope 的 main-to-renderer 事件

它不拥有：

- SDK options 和 system prompt：`agent-options.ts` / `query-runner.ts`
- 持久化 session metadata：`persistence/workspace-store.ts`
- Workspace session transcript 分页：`session-transcript.ts`
- Renderer 状态：`agent-store*`
- 产物数据库：当前不存在，文件目录就是事实来源

权限与 AskUser 的具体 pending 生命周期由 `pending-interactions.ts` 实现，
`SessionRuntimeController` 只提供带 envelope 的事件回调和 session 级终止意图。
生产通知与测试 fake 通过同一 notification adapter seam。

## Workspace lifecycle interaction

`workspace-lifecycle.ts` 是注册工作区变更的唯一 Main-process Module。删除工作区按以下顺序：

1. 校验请求对应已注册且非系统 Workspace。
2. `SessionRuntimeController` 按稳定 envelope 中的 `workspacePath` 终止并等待所有 run。
3. `cron-manager.ts` 暂停并等待关联 Workspace、Workspace session 或其子目录的自动化。
4. 将 Workspace 移入废纸篓；失败时恢复此前活动的自动化计划。
5. 一次性移除授权目录和 app session metadata。
6. 刷新索引并在操作结果中返回规范工作区列表；Renderer 将该结果投影到设置缓存一次。

Renderer 切换 Workspace 时，如果 live editor slot 属于另一个 Workspace，必须缓存旧 slot
并清空活动 session；不得通过修改 live slot 的 `workspacePath` 把旧 session 迁移到新
Workspace。

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

Agent IPC 请求使用 `src/shared/ipc-types.ts` 中定义的对象 payload；
`src/shared/preload-api.ts` 维护唯一 `window.api` Interface，preload 实现和 Renderer
共同消费该类型。

## 权限与用户输入

`canUseTool` 先执行 session 文件访问判断：

- 会话 working directory 内的允许操作可自动通过
- 内置 Skill 资源和本次消息显式授权的附件/外部路径按规则处理
- 其他工具进入 renderer 审批队列
- `AskUserQuestion` 使用独立的 AskUser 队列

会话 Agent 的审批模式属于 app session，而不是全局设置：

- `request`（请求批准）映射到 SDK `default`，除会话范围内已允许的操作外，其余权限请求交给用户确认
- `auto`（自动审批）映射到 SDK `auto`，由 SDK 的安全分类器自动批准或拒绝原本需要确认的请求
- 两种模式都必须先经过应用的 session 文件访问判断；SDK 自动审批不能越过未授权路径或受保护路径
- `AskUserQuestion` 不属于工具权限审批，两种模式下仍由用户回答
- 新会话及应用重启后默认使用 `request`；当前进程内切换会话时，各会话保留自己的选择

Renderer 回复必须携带 request ID；runtime 根据注册信息找到原 session。超时或 abort 会清理 pending Promise，避免后续响应串到其他会话。

## Transcript 与产品元数据

Claude SDK JSONL 保存 transcript。electron-store `SessionRecord` 保存：

- app session ID 与 SDK session ID 映射
- workspace/context/working directory
- 标题、摘要、标签、时间和消息计数

`session-transcript.ts` 通过 app session ID 解析 SDK session ID 和 working
directory。首屏优先从 JSONL 尾部读取；仅当首屏读取失败时降级到 SDK
Adapter。分页按最新页优先、页内时间正序返回，Main 签发的不透明游标会固定
后续请求的数据来源。`session-store.ts` 负责会话列表和变更；SDK compaction
产生的内部 session ID 会持久化过滤，不作为独立用户会话展示。

## Renderer invariants

1. `slots.editor` 和 `slots.ask` 只表示当前可见 context。
2. `sessionSlots` 保存每个会话的隔离状态；后台事件只更新对应 entry。
3. Session materialization 只合并临时 app slot 和 SDK 信息，不重命名 app session ID。
4. 权限、AskUser 和 Skill 输出按 request/session ID 路由。
5. IPC 静默只能触发非阻断提示，不能作为自动 abort 的依据。
6. 新查询替换旧查询时，同一 app session 的启动必须串行覆盖 identity validation、abort、prepare 和 register，并等待旧 runtime 的 finally 完成；不同 session 不得共享这把锁。
7. `registerRun()` 不允许覆盖 active run；实例保护仍负责阻止迟到的旧 cleanup 删除当前 run。

Renderer 的双表示规则由 `store/session-slot-state.ts` 独占：caller 不应自行在
`slots[context]` 与 `sessionSlots[sessionId]` 之间回退，也不应自行维护 LRU 顺序。
权限与 AskUser 的入队、当前项推进、排队项移除和 request target 定位同样经过该
module；超时与用户响应不能在 store action 中再次实现一套 live/cache 搜索。

## 修改检查表

新增会话功能时确认：

- payload 是否进入 `IPCChannelMap`
- session-affecting event 是否带 envelope
- 后台 session 是否不会修改当前 live slot
- app session ID 和 SDK session ID 是否保持分工
- abort、窗口关闭和超时是否清理资源
- transcript、产品 metadata 和生成文件的权威来源是否明确
- 是否增加了跨会话/竞态回归测试
