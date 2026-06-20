# 内置 Skill 统一架构

## 设计原则

1. **Skill 文件零修改** — 原封不动拷入 `src/main/skills/{id}/`，SKILL.md、模板、脚本、references 全部保留原始相对路径，SDK 自然发现
2. **Manifest 驱动** — `skills-manifest.ts` 声明式注册，不硬编码
3. **SkillDefinition 统一接口** — `builtin.ts` 定义 id/name/description/icon/promptTemplate/outputMode
4. **SkillOutputBridge 统一捕获** — main 进程拦截原始 SDK 流事件，无论 Write 工具还是 skill-output 代码块，归一为 `skill:output` IPC 事件
5. **Renderer 统一消费** — Zustand store 存 skillOutput，MessageBubble 只看 store 不关心通道来源

---

## 新增内置 Skill 三步流程

### Step 1: 拷入 skill 文件

```bash
git clone --depth 1 {repo-url} /tmp/{skill-id}
cp -r /tmp/{skill-id} src/main/skills/{skill-id}
rm -rf src/main/skills/{skill-id}/.git   # 移除嵌套 .git
```

### Step 2: 注册到 manifest

编辑 `src/main/skills/skills-manifest.ts`，在 `BUILTIN_SKILLS` 数组加一行：

```ts
{ id: '{skill-id}', hasResources: true },
```

### Step 3: 添加 SkillDefinition

编辑 `src/main/skills/builtin.ts`，在 `builtinSkills` 数组加一条：

```ts
{
  id: '{skill-id}',
  name: '{显示名}',
  description: '{中文描述}',
  icon: '{Phosphor图标名}',
  promptTemplate: `使用 {skill-id} skill 接下来... {activeFile}`,
  outputMode: 'write',  // 或 'skill-output'
},
```

**不需要改任何其他文件。** SkillOutputBridge 自动捕获输出，MessageBubble 自动渲染预览卡片。

### outputMode 判断

- Skill 通过 Write/Edit 工具输出文件 → `outputMode: 'write'`
- Skill 通过 skill-output 代码块输出 → `outputMode: 'skill-output'`

---

## 当前内置 Skills

| id | name | outputMode |
|----|------|------------|
| kami | Kami · 紙 | write |
| guizang-ppt-skill | PPT · 歸藏 | write |
| frontend-slides | Slides · 前端 | write |

---

## 技术架构

### 数据流全景

```
SDK Stream ──→ SessionRuntimeController ──→ SkillOutputBridge ──→ IPC skill:output ──→ Zustand store ──→ MessageBubble
     │                    │
     │                    └──→ toAgentIPCMessage() ──→ IPC agent:event ──→ store (messages/toolCalls)
     │
     └── 所有 IPC payload 都带 AgentSessionEnvelope（context / app session / SDK session / workspace）
```

两条 IPC 通道并行：
- `agent:event` — 常规消息流（对话、工具调用、结果）
- `skill:output` — 统一输出捕获流（实时内容推送，驱动 SkillOutputCard 预览）

### 1. Skill 文件初始化 — `skill-init.ts`

应用启动时，`skill-init.ts` 读取 `BUILTIN_SKILLS` manifest，将每个 skill 从 `src/main/skills/{id}/` 递归拷贝到 `{userData}/.claude/skills/{id}/`。

关键逻辑：
- **源**: `src/main/skills/{id}/`（打包进 asar）
- **目标**: `{userData}/.claude/skills/{id}/`
- **递归拷贝**: 保留 SKILL.md、assets/、references/、scripts/、templates/ 等完整目录结构
- **幂等**: 已存在且未变更则跳过（避免每次启动都覆盖）
- SDK 在 `buildOptions()` 中设置 `skills: 'all'`，自动扫描 `{userData}/.claude/skills/` 下所有 SKILL.md

### 2. SkillOutputBridge — `skill-output-bridge.ts`

统一输出捕获层，拦截 **原始 SDK 流事件**（在 `toAgentIPCMessage()` 转换之前）。

#### 核心方法

```ts
processRawEvent(rawMessage: Record<string, unknown>, activeSkillId: string | null): void
```

#### 捕获的两个通道

| 通道 | SDK 事件 | 触发条件 | 提取方式 |
|------|----------|----------|----------|
| Channel 1: skill-output 代码块 | `content_block_delta` + `text_delta` | 文本流中出现 ` ```skill-output ` 围栏 | 文本缓冲区检测围栏标记，提取围栏内内容 |
| Channel 2: Write/Edit 工具 | `content_block_start` + `tool_use` + `input_json_delta` | tool_name 为 Write 或 Edit | 累积 `input_json_delta`，解析 partial JSON 提取 content 字段 |

#### Partial JSON 提取

Write 工具的 input 是流式 JSON，`input_json_delta` 逐片到达。在 `content_block_stop` 之前 JSON 不完整：

```ts
extractContentFromPartialJson(json: string): string | null
// 输入: '{"content": "<!DOCTYPE html><html>...'
// 输入: '{"content": "<!DOCTYPE html><html><head>...'   (仍在流式中)
// 输出: '<!DOCTYPE html><html>...' 或 '<!DOCTYPE html><html><head>...'
```

原理：找到 `"content":` 键，从其后的 `"` 开始截取到当前末尾。即使 JSON 未闭合也能提取已到达的内容。

#### 节流推送

`pushOutput()` 内置节流：只有内容增长超过 ~500 字符才推送 IPC 事件，避免高频推送拖慢 renderer。

#### 状态管理

```ts
// Bridge 内部状态
writeAccumulators: Map<string, { toolName: string; json: string }>  // key = tool_use block id
textBuffer: string           // 文本缓冲区，检测跨 delta 分割的围栏标记
lastPushedLength: number     // 上次推送时的内容长度，用于节流判断
outputLanguage: string       // 输出语言（html/svg/text）

// 推送的 IPC payload（对应 shared/types.ts SkillOutputState）
{
  skillId: string | null,
  content: string,
  isStreaming: boolean,
  language: string,
}
```

### 3. Session Runtime 集成 — `session-runtime.ts` / `query-runner.ts`

```ts
// query-runner.ts 继续负责调用 SDK query()
// SessionRuntimeController 负责 app session / SDK session / workspace envelope
sessionRuntime.beginSession(envelope)
sessionRuntime.registerRun({ query, skillId, abortController, envelope })
```

#### 流式处理中的调用顺序（关键）

```ts
for await (const message of messageStream) {
  // runtime 在同一个入口里完成：
  // 1. 原始 SDK 事件进入 SkillOutputBridge（转换之前！）
  // 2. text_delta 批处理，保持顺序
  // 3. 非文本事件转换为应用级 IPC 消息
  // 4. 所有跨 IPC payload 附加 AgentSessionEnvelope
  sessionRuntime.emitSdkMessage(mainWindow, appSessionId, envelope, message)
}
```

**为什么必须在转换之前？** `toAgentIPCMessage()` 会将 SDK 原始事件转换为应用级消息（`assistant`、`tool_use_start` 等），丢失 `content_block_delta`/`input_json_delta` 等流式细节。Bridge 需要这些原始事件来提取实时内容。

### 4. IPC 通道 — Preload 层

```ts
// src/preload/index.ts
onSkillOutput: (callback: (state: SkillOutputState) => void) => {
  const handler = (_event, state: SkillOutputState) => callback(state)
  ipcRenderer.on('skill:output', handler)
  return () => { ipcRenderer.removeListener('skill:output', handler) }
},

// sendMessage 增加 skillId 参数
sendMessage: (prompt, sessionId?, activeFilePath?, skillId?) =>
  ipcRenderer.invoke('agent:sendMessage', prompt, sessionId, activeFilePath, skillId),
```

### 5. Renderer Store — Zustand

```ts
// src/renderer/store/agent-store.ts — 类型
skillOutput: SkillOutputState | null
handleSkillOutput: (state: SkillOutputState) => void

// src/renderer/store/agent-store-impl.ts — 实现
handleSkillOutput(state: SkillOutputState) {
  set({ skillOutput: state })
}

// 重置时机
// - result_success / result_error → skillOutput: null
// - newSession → skillOutput: null
```

**重要**: Zustand 的 `create()` 返回的是 hook 函数，外部调用必须用 `store.getState().handleSkillOutput(state)`，不能用 `store.handleSkillOutput(state)`。

### 6. Renderer Hook — `useAgent.ts`

```ts
// 订阅 skill:output IPC 事件
const unsubSkillOutput = window.api.agent.onSkillOutput((state) => {
  store.getState().handleSkillOutput(state)  // 注意: getState() 而非直接调用
})

// 导出 selector
export const useSkillOutput = () => useAgentStore((s) => s.skillOutput)
```

### 7. UI 渲染 — `MessageBubble.tsx`

```tsx
const skillOutput = useAgentStore((s) => s.skillOutput)
const isLastMessage = useAgentStore((s) => s.messages[s.messages.length - 1]?.id === message.id)
const showSkillOutput = isStreaming && isLastMessage && skillOutput && skillOutput.content.length > 0

{showSkillOutput && (
  <SkillOutputCard
    content={skillOutput.content}
    isStreaming={skillOutput.isStreaming}
    language={skillOutput.language}
  />
)}
```

条件：仅在**最后一条消息**且**正在流式输出**时显示 SkillOutputCard。流式结束后 `skillOutput` 被 store 重置为 null，卡片消失，由 artifact 卡片接管。

### 8. 类型定义 — `shared/types.ts`

```ts
export type SkillOutputState = {
  skillId: string | null
  content: string
  isStreaming: boolean
  language: string
}
```

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/main/skills/skills-manifest.ts` | 内置 skill manifest，声明式注册 |
| `src/main/skills/builtin.ts` | SkillDefinition 接口 + 定义数组 |
| `src/main/skills/{id}/` | 各 skill 完整文件（SKILL.md + 资源） |
| `src/main/skill-init.ts` | 应用启动时拷贝 skill 到 userData |
| `src/main/skill-output-bridge.ts` | 统一输出捕获层（main 进程） |
| `src/main/agent-manager.ts` | Bridge 集成 + activeSkillId 管理 |
| `src/main/ipc-handlers.ts` | sendMessage 传递 skillId |
| `src/preload/index.ts` | skill:output IPC 桥接 + sendMessage skillId |
| `src/shared/types.ts` | SkillOutputState 类型 |
| `src/renderer/store/agent-store.ts` | skillOutput 状态类型 |
| `src/renderer/store/agent-store-impl.ts` | handleSkillOutput 实现 |
| `src/renderer/hooks/useAgent.ts` | skill:output 订阅 + useSkillOutput selector |
| `src/renderer/lib/ipc.ts` | AgentApi 类型定义（onSkillOutput、sendMessage 签名） |
| `src/renderer/components/chat/MessageBubble.tsx` | SkillOutputCard 渲染逻辑 |
| `src/renderer/components/chat/SkillOutputCard.tsx` | 实时预览卡片组件 |
