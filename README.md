# sumi

`sumi` 是一款面向 macOS 的 AI 工作台，把 Markdown 编辑、Claude Agent 会话、项目文件、知识库、图谱和 Skills 放在同一个桌面应用中。

## 当前能力

- 多工作区与独立会话
- Tiptap Markdown 编辑器、选区 AI 改写审阅、源码模式、自动保存、表格、任务列表、Mermaid 和 KaTeX
- Claude Agent SDK 流式对话、工具审批、AskUser、会话恢复和分页历史
- 每个会话独立的生成文件目录与产物预览
- 全局搜索、知识库与双向链接图谱
- 内置 Skills、社区 Skill 安装/更新/卸载
- PDF、DOCX、PPTX、XLSX 附件转换
- 持久化定时任务和系统通知
- 应用更新、Sentry 集成（配置 `SENTRY_DSN` 后上报）和可恢复的界面错误提示

## 开发

要求：Node.js、npm、macOS。当前发布配置仅构建 Apple Silicon。

```bash
npm install
npm run dev
```

常用命令：

```bash
npm test
npm run build
npm run pack
npm run dist
```

`npm run pack` 生成未安装的 `.app`，`npm run dist` 生成 DMG/ZIP；两者都会校验内置 Skill 是否完整进入应用包。

## 配置与数据

模型 Profile、工作区、会话元数据、主题、Cron 和 Skill 开关由 `electron-store` 保存在应用数据目录。API Key 在系统支持时使用 Electron `safeStorage` 加密。

工作区会话的生成文件位于：

```text
<workspace>/.sumi/sessions/<session-hash>/
```

知识库默认位于用户 Documents 下的 `sumi/Knowledge`。

## 架构

应用采用 Electron Main 进程、Renderer 进程和 Preload 隔离桥接层。Renderer 启用 sandbox 和 context isolation，只能通过 Preload 暴露的 `window.api` 访问文件系统和系统能力。

- [开发规范](AGENTS.md)
- [架构说明](docs/architecture.md)
- [会话运行时](docs/session-runtime-architecture.md)
- [内置 Skill 架构](src/main/skills/BUILTIN-SKILL-ARCHITECTURE.md)

## 发布说明

当前 `electron-builder.yml` 的签名和 notarization 仍关闭，适合内部测试包，不应视为完成生产分发加固。
