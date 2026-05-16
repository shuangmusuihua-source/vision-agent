# Claude Agent SDK 集成参考

## 1. SDK 消息格式

### tool_use 与 tool_result 的位置

- `tool_use` 块出现在 `type === 'assistant'` 的消息中（`content` 数组中 `type: 'tool_use'` 的项）
- `tool_result` 块出现在 `type === 'user'` 的消息中（`content` 数组中 `type: 'tool_result'` 的项）

这是 SDK 的合成消息机制 — `tool_result` 是 SDK 自动生成的"用户消息"，用于将工具执行结果反馈给模型。**不要在 `type === 'assistant'` 的消息中查找 `tool_result`**。

### 消息类型速查

| type | subtype | 说明 |
|------|---------|------|
| `system` | `init` | 会话初始化，含 `session_id` |
| `assistant` | — | 模型回复，含 text 和 tool_use 块 |
| `user` | — | 合成消息，含 tool_result 块 |
| `result` | `success` | 会话正常结束，含 usage/cost |
| `result` | `error_max_turns` / `error_during_execution` / `error_max_budget_usd` | 会话异常结束 |
| `system` | `permission_denied` | 工具被自动拒绝（不经过 canUseTool） |
| `status` | `compacting` / `requesting` | 状态更新 |
| `control_request` | `can_use_tool` | 权限请求（触发 canUseTool 回调） |

## 2. 权限系统

### allowedTools vs canUseTool vs permissionMode

三者关系：

- **`allowedTools`** — 自动允许的工具列表，**不需要任何权限提示**就直接执行
- **`canUseTool`** — 自定义权限回调，在**每个非自动允许的工具执行前**被调用
- **`permissionMode`** — SDK 内置的权限分类器，决定哪些操作"危险"需要提示

### permissionMode 选项

| 模式 | 行为 |
|------|------|
| `default` | 标准行为，SDK 内部分类器判断危险操作 |
| `acceptEdits` | 自动接受文件编辑操作 |
| `bypassPermissions` | 跳过所有权限检查（需 `allowDangerouslySkipPermissions: true`） |
| `plan` | 规划模式，不执行工具 |
| `dontAsk` | 不弹权限提示，未预批准的自动拒绝 |
| `auto` | 用模型分类器自动批准/拒绝 |

### 推荐配置

```typescript
{
  allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],  // 只读工具自动允许
  permissionMode: 'default',  // SDK 内部分类器 + canUseTool 回调
  canUseTool: async (toolName, input, options) => {
    // Bash, Write, Edit 等走自定义权限逻辑
    // 弹出权限弹窗让用户审批
  }
}
```

### 关键发现

1. **`allowedTools` 不是"可用工具列表"** — 它是"自动允许"列表。不在列表中的工具仍然可用，只是需要权限审批
2. **`canUseTool` 在 SDK 内部分类器之后调用** — 如果 SDK 的 `default` 模式分类器已经自动允许了某个工具，`canUseTool` 不会被调用
3. **`permission_denied` 消息** — 当工具被自动拒绝（不经过 canUseTool）时，SDK 会发出 `type: 'system', subtype: 'permission_denied'` 消息

## 3. 环境变量

### env 必须包含 process.env

```typescript
// 错误 — Bash 工具找不到系统命令
const env: Record<string, string> = {}
env.ANTHROPIC_API_KEY = apiKey

// 正确 — 继承完整环境变量
const env: Record<string, string | undefined> = { ...process.env }
env.ANTHROPIC_API_KEY = apiKey
```

**原因**：SDK 的 `env` 选项**默认是 `process.env`**。如果只传部分变量，Bash 工具的 shell 环境会缺少 `PATH` 等关键变量，导致 `command not found: ls` 等错误。

## 4. 工具调用状态显示

### ToolCall 状态流转

```
running (spinner 旋转) → completed (绿色对勾) / error (红色叉号)
```

### 状态更新时机

- `running`：收到 `type === 'assistant'` 消息中的 `tool_use` 块时设置
- `completed` / `error`：收到 `type === 'user'` 消息中的 `tool_result` 块时更新

### CSS 动画

```css
.tool-call-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

使用 `Loader2` 图标（lucide-react）配合 `tool-call-spinner` class。

## 5. 原生二进制

SDK 优先使用平台原生二进制：

```typescript
// 1. 优先：平台原生二进制
require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')

// 2. 回退：cli.js
require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
```

## 6. Skill 发现

```typescript
const messageStream = query({
  prompt: '__skill_discovery_probe__',
  options: { ...options, skills: 'all' }
})
const skills = await (messageStream as Query).supportedCommands()
// 立即中止探测会话
try { (messageStream as Query).abort() } catch {}
```

`supportedCommands()` 返回 `SlashCommand[]`，包含 `name`、`description`、`argumentHint`、`aliases`。

## 7. 通知阈值

权限请求通知设置 30 秒阈值 — 如果用户在 30 秒内响应了权限弹窗，不发送系统通知；超过 30 秒才发送，提醒用户回到应用处理。
