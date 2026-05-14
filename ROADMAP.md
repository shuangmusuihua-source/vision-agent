# Vision Agent — 产品决策与路线图

## 产品定位

基于 Claude Agent SDK 的本地 Agent 驱动 Markdown 客户端。用户在类 Notion 界面中编辑 Markdown，同时拥有一个能操作文件系统、搜索网页、调度任务、运行 Skill 的本地 Agent。

**优先支持 macOS。**

---

## 核心功能

- Markdown 文件编辑、预览
- 基于文档的双向链接图谱
- 基于文档的持久化记忆系统
- 大模型配置（API Key / Provider / Model）
- 授权工作目录管理
- 授权目录内 Read / Edit / Write / Grep / Glob
- Cron 定时任务（自然语言驱动）
- WebFetch / WebSearch
- Skill 安装、卸载、运行
- 类 Notion 界面风格：极简、现代

---

## 技术决策

### 1. 技术栈：Electron + React + TypeScript

**候选方案对比：**

| 维度 | Electron | Tauri 2 |
|------|----------|---------|
| 后端语言 | Node.js（完整运行时） | Rust |
| 包体大小 | ~150-250MB | ~5-15MB |
| 内存占用 | ~200-400MB 基础 | ~30-80MB 基础 |
| 前端渲染 | Chromium 内嵌 | 系统 WebView |
| Node.js 原生支持 | 内置，child_process/fs 直接用 | 不支持，需 sidecar 或 shell 插件 |
| 跨平台一致性 | 极高（自带 Chromium） | 依赖系统 WebView，有细微差异 |
| 生态成熟度 | 10+ 年，极成熟 | 3 年，快速成长中 |
| 自动更新 | electron-updater 成熟方案 | Tauri 内置 updater 插件 |

**选择 Electron 的理由：**

Claude Agent SDK 的 TypeScript 版本通过 `child_process` 启动 `claude` 二进制子进程，使用 stdin/stdout JSON-RPC 通信，返回 AsyncGenerator 流式消息，内部依赖 Node.js 的 `fs`、`path`、`stream` 等模块。

- Electron：SDK 直接在主进程或 Utility 进程中运行，天然兼容，零额外工作
- Tauri：需要 sidecar 打包 claude 二进制 + 自行实现消息解析/session 管理/流式处理，或嵌入 Node.js 运行时（包体膨胀 ~50MB+），或用 Rust 从零重写 SDK 协议

Tauri 的轻量优势在需要嵌入 Node.js 运行时后被大幅削弱。150MB vs 15MB 的包体差异对桌面应用不是关键瓶颈。Agent SDK 是产品核心引擎，Electron 让它开箱即用。

### 2. Agent SDK 集成架构

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Markdown  │ │  Agent   │ │   Knowledge      │ │
│  │ Editor    │ │  Chat    │ │   Graph View     │ │
│  │ (Tiptap)  │ │  Panel   │ │   (D3/Cytoscape) │ │
│  └─────┬────┘ └────┬─────┘ └───────┬──────────┘ │
│        │            │               │            │
│        └────────────┼───────────────┘            │
│                     │ IPC (Electron)             │
├─────────────────────┼────────────────────────────┤
│              Main Process                         │
│              ┌──────┴──────┐                     │
│              │ AgentManager│                     │
│              │ - query()   │                     │
│              │ - sessions  │                     │
│              │ - hooks     │                     │
│              │ - cron      │                     │
│              └──────┬──────┘                     │
│                     │ child_process               │
│              ┌──────┴──────┐                     │
│              │ claude CLI  │                     │
│              │ (SDK 内部)   │                     │
│              └─────────────┘                     │
└─────────────────────────────────────────────────┘
```

**关键设计点：**

- `AgentManager` 在主进程管理所有 Agent 会话，通过 Electron IPC 把流式消息推到渲染进程
- 使用 `startup()` 预热 CLI 子进程，减少首次响应延迟
- Session 持久化由 SDK 自动处理（JSONL 文件），应用重启后可 `resume`
- Hooks 用于：权限拦截（只允许操作授权目录）、审计日志、通知推送
- Cron 调度在主进程用 `node-cron` 实现，到时触发 `query()` 执行任务

### 3. 图谱方案：先双向链接，再语义图谱

**方案 A — 双向链接图谱（类 Obsidian）：**

- 原理：解析 Markdown 中的 `[[链接]]` 语法，构建文档间引用关系图
- 解析：正则或 AST 解析，1000 篇文档 < 1 秒
- 存储：纯 JSON 图结构，1 万篇文档 < 1MB
- 渲染：D3.js force-directed graph，1000 节点流畅，5000+ 需要力导向优化
- 总内存：< 50MB
- 优点：确定性、可预测、用户可控、实现简单
- 缺点：只能发现显式链接，无法发现语义关联

**方案 B — 语义知识图谱：**

- 原理：Agent 用 LLM 从文档中提取实体和关系，构建可查询的知识图谱
- 提取：每篇文档需 1 次 LLM 调用，1000 篇 ≈ $2-5 API 费用
- 存储：SQLite + 图扩展，1 万篇文档 ~10-50MB
- 渲染：同方案 A
- 总内存：< 100MB + LLM API 成本
- 优点：发现隐含关联，支持自然语言查询
- 缺点：需要 API 调用成本，提取质量依赖 LLM，增量更新复杂

**决策：先做方案 A，再叠加方案 B。** 方案 A 作为基础层零成本可用；方案 B 作为 Agent 驱动的高级功能，用户按需触发。两者共享同一个图可视化组件。

### 4. 记忆系统：类 Claude Code 文件系统记忆

```
<workspace>/
└── .vision/
    └── memory/
        ├── MEMORY.md           # 索引文件（自动加载到上下文）
        ├── user_preferences.md # 用户偏好
        ├── project_context.md  # 项目上下文
        └── decisions.md        # 关键决策记录
```

**工作方式：**

- 每次对话开始，Agent 自动读取 `MEMORY.md` 索引，加载相关记忆
- Agent 在对话中发现值得记住的信息时，主动写入记忆文件
- 记忆文件就是 Markdown，用户可以直接编辑
- 与 Markdown 编辑器无缝集成——记忆文件在侧栏可见可编辑

### 5. Cron 调度：自然语言驱动

用户用自然语言描述任务，Agent 解析并注册定时任务：

```
用户: "每天早上9点扫描我的日记目录，总结昨天的内容"
Agent: 解析 → cron: "0 9 * * *" + prompt: "扫描日记目录，总结昨天内容"
       → 注册到调度器
```

**实现**：主进程维护 `node-cron` 调度表，到时调用 `query()` 执行 Agent 任务，结果写入指定 Markdown 文件或推送到 UI 通知。

---

## 开发路线图

### Phase 1：核心骨架（2-3 周）

**目标**：能编辑 Markdown + 能和 Agent 对话

| 任务 | 说明 |
|------|------|
| 项目初始化 | Electron + React + TypeScript + Vite 脚手架 |
| 基础窗口框架 | Notion 风格三栏布局：侧栏导航 + 编辑区 + Agent 面板 |
| Markdown 编辑器 | 集成 Tiptap，支持实时预览、代码高亮、表格 |
| Agent SDK 集成 | 主进程 AgentManager，IPC 消息桥，流式输出到 UI |
| Agent 对话 UI | 聊天面板：消息气泡、代码块渲染、工具调用展示 |
| 大模型配置 | 设置页面：API Key 输入、模型选择、API Provider 切换 |
| 工作目录授权 | 目录选择器 + 权限管理，Agent 只能在授权目录操作 |

**交付物**：可运行的桌面应用，能编辑 Markdown 文件，能和 Agent 对话让 Agent 读写文件

### Phase 2：Agent 能力完善（2 周）

**目标**：Agent 完整工具链 + 会话管理

| 任务 | 说明 |
|------|------|
| 文件操作工具 | Read/Edit/Write/Glob/Grep 在授权目录内的完整支持 |
| Web 工具 | WebSearch + WebFetch 集成，结果渲染到聊天 |
| 权限系统 | canUseTool 回调 → UI 弹窗审批，允许/拒绝/始终允许 |
| 会话管理 | 会话列表、恢复、重命名、删除 |
| Hooks 集成 | PreToolUse 拦截未授权操作，PostToolUse 审计日志 |
| Agent 状态展示 | 工具调用实时展示、进度指示、费用统计 |

**交付物**：Agent 能完整操作文件系统、搜索网页，有完善的权限和会话管理

### Phase 3：记忆系统 + 图谱（2-3 周）

**目标**：知识管理和可视化

| 任务 | 说明 |
|------|------|
| 双向链接语法 | `[[链接]]` 解析、自动补全、悬停预览 |
| 记忆系统 | `.vision/memory/` 目录结构，Agent 自动读写记忆 |
| 记忆 UI | 侧栏记忆面板，查看/编辑/删除记忆条目 |
| 图谱数据层 | 从 `[[链接]]` 构建图结构，增量更新 |
| 图谱可视化 | D3.js force-directed graph，节点点击跳转文档 |
| 图谱交互 | 搜索过滤、节点高亮、邻居展开、缩放平移 |

**交付物**：文档间有双向链接和图谱可视化，Agent 有持久化记忆

### Phase 4：调度 + Skill（2 周）

**目标**：自动化和可扩展性

| 任务 | 说明 |
|------|------|
| Cron 调度 | 自然语言 → cron 解析，任务注册/删除/列表 |
| 调度 UI | 任务列表、状态监控、执行历史、手动触发 |
| Skill 发现 | 扫描 `.claude/skills/` 目录，列出可用 Skill |
| Skill 安装/卸载 | 从 URL 或本地路径安装 Skill，卸载时清理 |
| Skill 运行 | 聊天面板中 `/skill-name` 触发，结果流式展示 |
| 通知系统 | Cron 任务完成通知、Agent 空闲通知 |

**交付物**：支持定时任务和 Skill 插件系统

### Phase 5：打磨 + 高级功能（2 周）

**目标**：生产级体验

| 任务 | 说明 |
|------|------|
| 语义图谱 | Agent 按需提取实体/关系，叠加到链接图谱上 |
| 文件树侧栏 | 授权目录的文件浏览器，拖拽打开 |
| 全局搜索 | 跨文档全文搜索（Agent 驱动或本地索引） |
| 暗色主题 | Notion 风格明暗切换 |
| 性能优化 | 大文件虚拟滚动、图谱渲染优化、Agent 响应缓存 |
| 自动更新 | electron-updater 集成 |
| macOS 打包 | DMG 签名分发 |

**交付物**：可分发的 macOS 桌面应用

---

**总预估：10-12 周**
