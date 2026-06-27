# 内置 Skill 统一架构

## 设计原则

1. **Skill 文件零修改** — 原封不动拷入 `src/main/skills/{id}/`，SKILL.md、模板、脚本、references 全部保留原始相对路径，SDK 自然发现
2. **Manifest 驱动** — `skills-manifest.json` 声明内容版本和必需资源，不硬编码
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

编辑 `src/main/skills/skills-manifest.json`，增加一项：

```json
{
  "id": "{skill-id}",
  "hasResources": true,
  "contentVersion": 1,
  "requiredPaths": ["SKILL.md"]
}
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
SDK Stream ──→ SessionRuntimeController ──→ SkillOutputBridge ──→ IPC skill:output ──→ Zustand store ──→ ChatView
     │                    │
     │                    └──→ toAgentIPCMessage() ──→ IPC agent:event ──→ store (messages/toolCalls)
     │
     └── 所有 IPC payload 都带 AgentSessionEnvelope（context / app session / SDK session / workspace）
```

两条 IPC 通道并行：
- `agent:event` — 常规消息流（对话、工具调用、结果）
- `skill:output` — 统一输出捕获流（实时内容推送，驱动 SkillOutputCard 预览）

### 1. Skill 文件初始化 — `skill-init.ts`

应用启动时，`skill-init.ts` 读取 manifest，通过 `builtin-skill-installer.ts` 将每个 Skill 从应用资源目录同步到 `{userData}/.claude/skills/{id}/`。所有工作区共享这一份运行时安装；工作区仅创建指向全局安装的目录链接，不再复制资源。

关键逻辑：
- **源**: 开发环境为 `src/main/skills/{id}/`，正式环境为 `resources/skills/{id}/`
- **目标**: `{userData}/.claude/skills/{id}/`
- **递归拷贝**: 保留 SKILL.md、assets/、references/、scripts/、templates/ 等完整目录结构
- **幂等**: 按每个 Skill 的 `contentVersion` 和已安装文件清单判断；版本变化或资源缺失时原子替换
- **完整性**: `pack` / `dist` 完成后比较源目录与 `.app` 中的全部 Skill 文件，缺失即让发布命令失败
- **发现**: SDK 保持原会话存储配置，使用 `settingSources: ['project']` 从工作区轻量链接发现 Skill；Ask sumi 直接从应用数据目录发现
- **升级**: 修改内置 Skill 内容时必须递增对应 `contentVersion`

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
| Channel 2: 写入型工具 | `content_block_start` + `tool_use` + `input_json_delta` | tool_name 为 Write / Edit / MultiEdit / Bash | 累积 `input_json_delta`，按工具语义提取可预览内容：Write.content、Edit.new_string、MultiEdit.edits[].new_string、Bash heredoc HTML/MD |

#### Partial JSON 提取

写入型工具的 input 是流式 JSON，`input_json_delta` 逐片到达。在 `content_block_stop` 之前 JSON 不完整：

```ts
extractPreviewContentFromPartialJson(toolName: string, json: string): string | null
// 输入: '{"content": "<!DOCTYPE html><html>...'
// 输入: '{"new_string": "<section class=\"slide\">...'
// 输入: '{"command": "cat > deck.html <<'EOF'\n<!DOCTYPE html>...'
// 输入: '{"content": "<!DOCTYPE html><html><head>...'   (仍在流式中)
// 输出: '<!DOCTYPE html><html>...' 或 '<!DOCTYPE html><html><head>...'
```

原理：按工具名选择字段并从 partial JSON 中提取已到达的字符串内容；即使 JSON 未闭合也能提取当前内容。Bash 只预览看起来像 HTML/MD/SVG 产物写入的 heredoc，避免把普通 shell 脚本当成产物内容。

#### 节流推送

`pushOutput()` 内置节流：只有内容增长超过 ~500 字符才推送 IPC 事件，避免高频推送拖慢 renderer。

#### 状态管理

```ts
// Bridge 内部状态
writeAccumulators: Map<string, { toolName: string; json: string }>  // key = tool_use block id
textBuffer: string           // 文本缓冲区，检测跨 delta 分割的围栏标记
lastPushedLength: number     // 上次推送时的内容长度，用于节流判断
outputLanguage: string       // 输出语言（html/svg/text）

// 推送的 IPC payload（对应 shared/types.ts SessionRoutedSkillOutputState）
{
  skillId: string | null,
  content: string,
  isStreaming: boolean,
  language: string,
  context: AgentContext,
  sessionId: string,        // app-owned stable session id
  clientSessionKey: string, // same app-owned stable route key
  sdkSessionId?: string,
  workspacePath: string,
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
onSkillOutput: (callback: (state: SessionRoutedSkillOutputState) => void) => {
  const handler = (_event, state: SessionRoutedSkillOutputState) => callback(state)
  ipcRenderer.on('skill:output', handler)
  return () => { ipcRenderer.removeListener('skill:output', handler) }
},

// sendMessage 增加 skillId 参数
sendMessage: (prompt, sessionId?, activeFilePath?, skillId?) =>
  ipcRenderer.invoke('agent:sendMessage', { prompt, sessionId, activeFilePath, skillId }),
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
export const useSkillOutput = (context) => useAgentStore((s) => s.slots[context].skillOutput)
```

### 7. UI 渲染 — `ChatView.tsx`

```tsx
const skillOutput = useSkillOutput(context)
const showLiveSkillOutput = isStreaming && !!skillOutput?.content

{showLiveSkillOutput && (
  <SkillOutputCard
    content={skillOutput.content}
    isStreaming={skillOutput.isStreaming}
    language={skillOutput.language}
  />
)}
```

条件：当前会话正在流式输出且该会话有 `skillOutput.content` 时显示 SkillOutputCard。它是会话级实时预览，不依赖最后一条消息是否为 assistant 文本，因此 tool-only / skill-only 的生成流程也能展示。流式结束后 `skillOutput` 被 store 重置为 null，卡片消失，由 artifact 卡片接管。

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
| `src/main/skills/skills-manifest.json` | 内置 Skill manifest，声明内容版本和必需资源 |
| `src/main/builtin-skill-installer.ts` | 全局安装、完整性检查和原子版本升级 |
| `src/main/workspace-skill-links.ts` | 将工作区 Skill 入口链接到全局安装 |
| `src/main/skills/builtin.ts` | SkillDefinition 接口 + 定义数组 |
| `src/main/skills/{id}/` | 各 skill 完整文件（SKILL.md + 资源） |
| `src/main/skill-init.ts` | 解析应用路径并初始化全局 Skill |
| `src/main/skill-output-bridge.ts` | 统一输出捕获层（main 进程） |
| `src/main/agent-manager.ts` | Bridge 集成 + activeSkillId 管理 |
| `src/main/ipc-handlers.ts` | sendMessage 传递 skillId |
| `src/preload/index.ts` | skill:output IPC 桥接 + sendMessage skillId |
| `src/shared/types.ts` | `SkillOutputState` / `SessionRoutedSkillOutputState` 类型 |
| `src/renderer/store/agent-store.ts` | skillOutput 状态类型 |
| `src/renderer/store/agent-store-impl.ts` | handleSkillOutput 实现 |
| `src/renderer/hooks/useAgent.ts` | skill:output 订阅 + useSkillOutput selector |
| `src/renderer/lib/ipc.ts` | AgentApi 类型定义（onSkillOutput、sendMessage 签名） |
| `src/renderer/components/chat/ChatView.tsx` | SkillOutputCard 会话级渲染逻辑 |
| `src/renderer/components/chat/SkillOutputCard.tsx` | 实时预览卡片组件 |
