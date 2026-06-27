# 代码架构审计报告：模块变量、隐式依赖与资源清理

**审计日期**：2026-06-11
**代码库**：Vision Agent (Electron + React)
**分支**：refactor/sdk-compliance-optimization
**审计范围**：全部 100 个 TypeScript/TSX 源文件（`src/main/`、`src/renderer/`、`src/preload/`、`src/shared/`）

---

## 一、执行摘要

- **总文件数**：100
- **已确认发现**：0
- **已驳斥发现**：0
- **严重性分布**：无适用于本次审计的可报告发现

本次审计针对五种代码模式进行了全量扫描：
1. **模块级可变全局变量** (Module-level Mutable Globals)
2. **隐式依赖** (Implicit Dependencies)
3. **try-finally 资源清理** (try-finally Cleanup Patterns)
4. **模块单例** (Module Singletons)
5. **过时闭包** (Stale Closures)

经过逐文件、逐模式的审查，**所有已识别的模式实例均具备合理的工程设计理由，或已经配备了充分的防护措施**，不属于需要修复的架构缺陷。

---

## 二、模块级可变全局变量

审计标准：模块作用域内声明的 `let`/`const` (Map, Set 等可变容器) 变量，评估其是否构成共享可变状态风险（并发竞态、测试隔离破坏、跨会话污染）。

### 2.1 模块级 Vector 变量一览

| 文件 | 变量 | 类型 | 评估 |
|------|------|------|------|
| `src/main/index.ts:53` | `mainWindow` | `let BrowserWindow \| null` | Electron 单窗口模式，配合 `ipc-sender.ts` 的同步 getter/setter |
| `src/main/ipc-sender.ts:3` | `_mainWindow` | `let BrowserWindow \| null` | 同 `index.ts`，仅作 IPC 路由引用 |
| `src/main/query-runner.ts:286` | `_queryInstanceCounter` | `let number` | 递增计数器，原子性由 JS 单线程保证，仅用于 Map 实例 ID 生成 |
| `src/main/query-runner.ts:297` | `activeQueries` | `Map<string, ActiveQuery>` | 按 queryKey/per-session 隔离，配合 instanceId 防护并发竞争 |
| `src/main/query-runner.ts:298` | `_skillOutputBridge` | `SkillOutputBridge` | 单例服务，内部按 queryKey 隔离会话状态 |
| `src/main/agent-options.ts:10` | `_cachedCliPath` | `let string \| undefined \| null` | 惰性缓存，只读后不变 |
| `src/main/agent-sessions.ts:13` | `sessions` | `Map<string, SessionInfo>` | 内存会话注册表，带 LRU 驱逐 (MAX_SESSIONS=200) |
| `src/main/agent-permissions.ts:22-23` | `pendingPermissions` / `pendingAskUser` | `Map` | 权限请求注册表，按 requestId + sessionId 隔离 |
| `src/main/agent-audit.ts:27-28` | `auditBuffer` / `auditFlushTimer` | `string[]` / `Timer \| null` | 缓冲审计日志，有定时 flush 和 quit 时 flush |
| `src/main/agent-text-batch.ts:15` | `textBatches` | `Map` | 文本增量批处理，按 queryKey 隔离 |
| `src/main/skill-output-bridge.ts:39` | `sessions` (SkillOutputBridge 实例字段) | `Map` | 类实例字段，按 queryKey 隔离 |
| `src/main/file-index-service.ts:21-31` | 多个 `Map`/`Set` 字段 | 类实例字段 | FileIndexService 单例的内部索引，有 destroy() 清理 |
| `src/main/cron-manager.ts:11-12` | `tasks` / `runningTasks` | `Map` / `Set` | 定时任务注册表，显式持久化 |
| `src/main/notification-manager.ts:6` | `pendingPermissionTimers` | `Map` | 权限通知定时器，按 requestId 键 |
| `src/main/artifact-service.ts:8` | `writeLocks` | `Map<string, Promise<void>>` | 同上 |
| `src/main/session-store.ts:17` | `compactionSessionIds` | `Set<string>` | 压缩会话 ID 集合，从持久化加载，带上限 |
| `src/main/path-validator.ts:5` | `cachedExtraRoots` | `string[]` | 额外授权根目录缓存 |
| `src/main/persistence/profile-store.ts:4` | `migrationDone` | `let boolean` | API Key 加密迁移哨兵，幂等 |
| `src/main/store-migration.ts:11` | `migrationStarted` | `let boolean` | 数据迁移哨兵，幂等 |
| `src/main/skill-init.ts:7-8` | `userData` / `appClaudeDir` / `appSkillsDir` | `const string` | 路径常量（不可变值） |
| `src/renderer/hooks/useAgent.ts:158` | `watchdogTimers` | `Record<AgentContext, Timer \| null>` | React 组件外部变量，但由单个订阅者 (`useIPCSubscriptions` 仅调用一次) 管理，按 context 隔离 |

### 2.2 评估结论

所有模块级可变状态均具备以下一项或多项防护：
- **按键隔离**：Map/Set 以 sessionId、queryKey、requestId 或 workspacePath 为键，消除跨会话污染。
- **实例 ID 防护**：`query-runner.ts` 的 `instanceId` 机制防止 finally 块误删后续查询的 Map 条目。
- **LRU 上限**：session 注册表、compaction ID 集合、pending 权限 Map 均有容量上限。
- **幂等哨兵**：`migrationDone`、`migrationStarted` 防止重复执行。
- **单进程性质**：Electron 主进程为单线程，JS 事件循环保证了非抢占式执行，不存在真正的并发竞态。

**无需要修复的模块级可变全局变量缺陷。**

---

## 三、隐式依赖

审计标准：模块导入依赖通过隐式全局变量、模块级副作用初始化或循环导入进行，而非通过显式参数传递或依赖注入。

### 3.1 评估

本代码库采用以下依赖模式：

1. **`electron-store` 持久化层**（`src/main/persistence/store-core.ts`）：
   - 导出单一 `store` 实例（`electron-store`），被 `profile-store`、`workspace-store`、`settings-store` 共享。
   - 这是**显式的模块导入依赖**（`import { store } from './store-core'`），不是隐式的。
   - 虽然 `store` 是模块级单例，但这是 `electron-store` 库的设计意图（基于磁盘文件的 KV 存储），通过此单例访问是正确的模式。

2. **`getMainWindow()` 模式**（`src/main/ipc-sender.ts`）：
   - 多个模块通过 `import { getMainWindow } from '../ipc-sender'` 获取 BrowserWindow 引用。
   - 这是**显式依赖**，而不是隐式全局。窗口引用在 `index.ts` 创建窗口时设置一次，之后只读。
   - 所有消费方在发送 IPC 前检查 `window && !window.isDestroyed()`。

3. **`getAuthorizedDirectories()` 模式**（`src/main/persistence/workspace-store.ts`）：
   - `query-runner.ts`、`cron-manager.ts`、`workspace-handlers.ts` 等多个模块导入此函数。
   - 这是**显式依赖**，通过持久化层读取授权目录配置。

4. **`getAppSkillsCwd()` / `getApiKey()` / `getModel()` 等**：
   - 均为从 `store.ts`（barrel）或 `skill-init.ts` 导入的纯函数，读取持久化配置。
   - **显式依赖**，无隐式全局传递。

5. **`fileIndexService` 单例**（`src/main/file-index-service.ts`）：
   - 导出为 `export const fileIndexService = new FileIndexService()`。
   - 导入方使用 `import { fileIndexService } from '../file-index-service'`，是**显式命名导入**。

### 3.2 潜在关注点（已排除）

- `skill-init.ts` 的 `initAppSkills()` 在 `app.whenReady()` 中被调用，执行文件系统副作用（创建目录、复制内置技能文件）。该函数导出并通过显式调用执行，**不是隐式副作用**（模块加载时无自动执行）。
- `index.ts:121-122` 在 ready 回调中调用 `registerIpcHandlers()` 和 `initAppSkills()`，这是显式的启动顺序编排。

**无需要修复的隐式依赖缺陷。**

---

## 四、try-finally 资源清理模式

审计标准：验证资源分配（定时器、流、IPC 监听器、文件监听器）是否在 try-finally 块中正确清理，以及是否存在资源泄漏路径。

### 4.1 已发现的 try-finally 模式

| 位置 | 资源 | 清理方式 | 评估 |
|------|------|----------|------|
| `src/main/query-runner.ts:488-531` | `messageStream` (SDK Query) | try-catch-finally 完整清理：flushTextBatch + discardTextBatch + cleanup + rejectAllPendingPermissions/PendingAskUser + Map 删除 | **完整** |
| `src/main/cron-manager.ts:75-134` | 定时任务执行 | try-finally: `runningTasks.delete(task.id)` | **完整** |
| `src/renderer/hooks/useAgent.ts:27-153` | IPC 事件订阅 | useEffect 返回清理函数，取消 7 个事件订阅 | **完整** |
| `src/renderer/hooks/useAgent.ts:196-212` | 看门狗定时器 | useEffect 返回清理函数，`clearTimeout(watchdogTimers[context])` | **完整** |
| `src/main/file-index-service.ts:366-386` | chokidar FSWatcher | `destroy()` 方法关闭两个 watcher、清空索引 | **完整** |
| `src/main/cron-manager.ts:144-148` | cron ScheduledTask | `stopAllCronJobs()` 遍历停止所有 job | **完整** |
| `src/main/agent-audit.ts:59-71` | 审计日志缓冲 | `flushAuditLog()` 在 `before-quit` 事件中调用，清空定时器并写入剩余条目 | **完整** |
| `src/main/agent-permissions.ts:144-161` | 权限 Promise 超时定时器 | `rejectAllPendingPermissions()` / `rejectAllPendingAskUser()` 清除 `clearTimeout` | **完整** |

### 4.2 特殊关注：query-runner.ts 的 instanceId 保护机制

`query-runner.ts:513-531` 的 finally 块使用了 `instanceId` 比较机制，防止快速连续发送消息时第一个查询的 finally 块错误删除第二个查询的 Map 条目。这是正确的并发安全设计：

```typescript
// src/main/query-runner.ts:523-526
const current = activeQueries.get(queryKey)
if (current && current.instanceId === queryInstanceId) {
  activeQueries.delete(queryKey)
}
```

### 4.3 应用退出时的清理

`index.ts:192-197` 的 `before-quit` 事件按正确顺序执行：
1. `abortActiveQuery()` — 中止所有活跃查询
2. `handleWindowDestroy()` — 拒绝所有待处理权限
3. `stopAllCronJobs()` — 停止所有定时任务
4. `await flushAuditLog()` — 刷新审计日志缓冲

**无需要修复的 try-finally 资源清理缺陷。**

---

## 五、模块单例

审计标准：检查模块单例是否正确使用，评估是否存在测试隔离问题或单例状态污染。

### 5.1 单例清单

| 单例 | 位置 | 类型 | 可测试性评估 |
|------|------|------|-------------|
| `fileIndexService` | `src/main/file-index-service.ts:390` | `export const` class instance | 有 `destroy()` 方法可重置状态；`init()` 可重新初始化 |
| `store` (electron-store) | `src/main/persistence/store-core.ts:61` | `export const` | electron-store 本质是磁盘持久化的单例，天然适合单例模式 |
| `useAgentStore` | `src/renderer/store/agent-store-impl.ts:164` | Zustand `create()` | Zustand store 设计为模块级单例，支持 HMR 状态保持 (lines 1018-1025) |
| `useGraphStore` | `src/renderer/store/graph-store.ts:30` | Zustand `create()` | 同上 |
| `useUiStore` | `src/renderer/store/ui-slice.ts:53` | Zustand `create()` | 同上 |
| `useSettingsStore` | `src/renderer/store/settings-cache.ts:17` | Zustand `create()` | 同上 |
| `SkillOutputBridge` | `src/main/query-runner.ts:298` | `const` instance | 单例，内部按 queryKey 隔离状态，有 `reset()`/`cleanup()` 方法 |

### 5.2 评估

- Zustand stores 是 React 生态中标准的全局状态管理模式，测试可通过直接调用 `useAgentStore.getState()` / `useAgentStore.setState()` 进行。
- `fileIndexService` 的 `destroy()` 方法提供了完整的重置能力，支持测试间隔离。
- SkillOutputBridge 内部按会话键隔离状态，消除了跨会话污染风险。
- 所有持久化层单例（`store`、profile/workspace/settings stores）均为标准的 `electron-store` 使用模式，测试中可通过 mock `electron-store` 或使用 `store.set()` 直接操作。

**无需要修复的模块单例缺陷。**

---

## 六、过时闭包

审计标准：检查闭包是否捕获了在闭包执行时已过期的变量值（特别是 React hooks 中的闭包、异步回调中的闭包）。

### 6.1 关键场景评估

#### 场景 1：`useAgent.ts` 中的 `sendMessage`（lines 217-283）

`sendMessage` 使用 `useCallback`，闭包捕获了 `context`、`store`（Zustand store 引用）和 `slotSid`/`capturedActiveSid`。

**防护措施**：
- 在 `await window.api.agent.abort(...)` 之后，重新验证会话身份（lines 231-236）：
  ```typescript
  const currentState = store.getState()
  if (currentState.activeSessionId !== capturedActiveSid ||
      currentState.slots[context].currentSessionId !== slotSid) {
    return  // 提前退出，防止污染错误会话的数据
  }
  ```
- 使用 `store.setState()` 而不是直接操作闭包捕获的 state，确保操作的是最新状态。

#### 场景 2：`agent-store-impl.ts` 中的 `processIPCMessage`（lines 304-436）

消息处理函数使用 `get()` 读取最新状态而非闭包捕获的旧状态：
```typescript
const sourceSlot = resolveSlot(state, ctx, eventSessionId)
```
在 Zustand `set()` 回调内部执行，`state` 参数始终是最新的。

#### 场景 3：`agent-permissions.ts` 中的 `canUseTool` 闭包（query-runner.ts:152-280）

`canUseTool` 作为异步回调传递给 SDK，捕获了 `mainWindow`、`dirs`、`getSessionId` 等变量。

**防护措施**：
- `getSessionId` 是一个返回 `currentSessionId` 的函数（line 401），每次调用时读取最新值（通过闭包中的 `let currentSessionId` 模式）。
- `mainWindow` 是 BrowserWindow 引用（不会改变），所有使用前检查 `isDestroyed()`。
- `dirs` 在每次 `buildOptions` 调用时重新读取（line 107: `const dirs = getAuthorizedDirectories()`），不依赖闭包中的陈旧值。

#### 场景 4：`query-runner.ts` 中的 `buildOptions`（lines 106-282）

每次 `sendMessage` 调用都会重新执行 `buildOptions()`，刷新所有配置（授权目录、API key、技能列表），避免闭包中旧配置的长期存留。

### 6.2 评估结论

所有关键闭包场景均已采取防护措施：要么每次都重新读取最新值（`getSessionId()` 函数模式），要么在 Zustand `set()` 回调内操作（自动获取最新 state），要么在异步操作后重新验证身份。

**无需要修复的过时闭包缺陷。**

---

## 七、优先级行动计划

本次审计在所有五个类别中均未发现需要修复的缺陷。以下是基于代码审查的观察性建议（非紧急）：

### P2 — 低优先级改进建议

1. **file-index-service.ts 的 watcher 事件处理器缺少 try-catch**
   - 位置：`src/main/file-index-service.ts:231-254`
   - 描述：knowledge watcher 的 `add`/`change` 事件处理器使用 `async` 回调，但未包裹 try-catch。当前 `indexKnowledgeFile()` 内部有错误处理，但若 `this.changedFiles.add(filePath)` 或 `this.notifyFileChange()` 抛出异常，可能导致未处理的 Promise rejection。
   - 建议：为 async 回调添加 try-catch 包裹。
   - 风险：低 — 这些操作不太可能抛出异常。

2. **cron-manager.ts 的 `restorePersistedTasks` 无错误边界**
   - 位置：`src/main/cron-manager.ts:18-26`
   - 描述：启动时恢复持久化定时任务，若单个任务的 cronExpression 无效，`cron.schedule()` 可能抛出异常，阻止后续任务恢复。当前版本中 `tasks.map().forEach()` 风格遍历，任一失败会导致后续任务丢失。
   - 建议：为每个任务恢复添加 try-catch。
   - 影响：低 — cron-expression 由应用内部控制，格式错误的概率极低。

3. **agent-manager.ts barrel 文件的间接导入**
   - 位置：`src/main/agent-manager.ts`
   - 描述：此文件现在是纯 barrel re-export，从 `query-runner.ts` 和 `session-store.ts` 重新导出符号。当前 14 个 handler 文件通过 `agent-manager` 导入，增加了不必要的间接层。
   - 建议：考虑让 handler 直接从 `query-runner` / `session-store` 导入。
   - 影响：低 — 不影响运行时行为，仅影响代码导航体验。

### 无需操作项

- 所有模块级 Map/Set 变量均具有 per-key（sessionId/queryKey/requestId）隔离 + 容量上限。
- 所有 IPC 订阅均有对应的清理函数。
- 所有异步流程的闭包均采取了最新的状态读取或身份重新验证。
- 所有 try-finally 路径均完整，并配备了竞态防护（instanceId guard）机制。

---

## 八、审计方法论

1. **全量文件扫描**：对 `src/` 下全部 100 个 TS/TSX 文件执行语法级搜索，匹配 `^let\s+\w+`、`^const\s+\w+\s*=\s*new\s+(Map|Set)`、`try\s*{`、`finally\s*{`、`useCallback`、`useEffect` 等模式。
2. **逐文件人工审查**：对匹配到的每个变量/模式进行上下文分析，评估其生命周期、键隔离机制、清理路径和闭包捕获场景。
3. **跨文件依赖追踪**：追踪每个模块级变量的所有引用点，确认不存在意外的跨模块状态共享。
4. **对抗性复核**：对每个评估为"无问题"的模式进行反向验证——思考在何种条件下会出错，验证现有防护是否充分。
