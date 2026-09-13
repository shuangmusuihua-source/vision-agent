# sumi

`sumi` 是一款面向 macOS 的 AI 工作台，把 Markdown 编辑、AI 助手会话、项目文件、知识库、图谱和 Skills 放在同一个桌面应用中。

## 当前能力

- 多工作区与独立会话
- Tiptap Markdown 编辑器、选区 AI 改写审阅、源码模式、自动保存、表格、任务列表、Mermaid 和 KaTeX
- 流式 AI 对话、操作审批、交互式提问、会话恢复和分页历史
- 每个会话独立的生成文件目录与产物预览
- 全局搜索、知识库与双向链接图谱；原始资料可整理成带来源的主题，支持草稿审阅与撤回上次整理
- 内置 Skills、社区 Skill 安装/更新/卸载；从任务提炼个人 Skill，预览编辑后保存并复用
- 连接器侧边栏，以及由 sumi 隔离管理、按需安装和授权的飞书 CLI 能力
- PDF、DOCX、PPTX、XLSX 附件转换
- 可选的 Office 文档能力：无需安装 Microsoft Office，创建、编辑、渲染并校验 DOCX、XLSX 和 PPTX
- 持久化定时任务和系统通知
- 应用更新、Sentry 集成（配置 `SENTRY_DSN` 后上报）和可恢复的界面错误提示

## 开发

要求：Node.js 24 LTS、npm、macOS。当前发布配置仅构建 Apple Silicon。

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

`npm run pack` 生成未安装的 `.app`，`npm run dist` 生成 DMG/ZIP；两者都会校验内置 Skill 完整性和 `app.asar` 运行时文件 allowlist。

## 视觉资产

- `build/icon.icns`、`build/icon.png` 和 `build/icon_preview.png` 是 S 形系统应用图标，分别用于发布包、开发 Dock 和设置页。
- `src/renderer/assets/sumi-assistant-bull.svg` 是应用内助手牛形象，用于 Ask sumi、侧边栏快捷入口和 renderer favicon；不要用它覆盖系统应用图标。

## 配置与数据

模型 Profile、工作区、会话元数据、主题、Cron 和 Skill 开关由 `electron-store` 保存在应用数据目录。API Key 在系统支持时使用 Electron `safeStorage` 加密。

工作区会话的生成文件位于：

```text
<workspace>/.sumi/sessions/<session-hash>/
```

知识库默认位于用户 Documents 下的 `sumi/Knowledge`。在任务成果页使用「加入并整理知识」，或在知识库勾选原始资料后点击「整理资料」。主题在预览保存后生效，原文保留；无变化的资料会跳过重复整理。

在任务成果页点击「保存为我的 Skill」，填写想保留的方法，可以新建个人 Skill 或更新已有个人 Skill。保存后在技能页的「我的 Skill」中编辑、启停和用于任务。提炼使用当前模型配置；二进制成果参考任务对话中的制作过程，长任务会提示所采用的最近对话范围。

首次启用“Office 文档”内置能力时，sumi 会下载并校验固定版本的 OfficeCLI 到应用自己的运行时目录；不会修改其他 Agent 配置，也不会启用 OfficeCLI 自动更新。

飞书连接器同样使用应用自管运行时：sumi 校验固定版本的飞书 CLI，并把应用配置与账号授权保存在独立目录。连接后可以在权限面板按日历、文档、消息等业务域增量授权；连接完成前飞书 Skill 不会进入 Agent 的可用能力集合。

## 架构

应用采用 Electron Main 进程、Renderer 进程和 Preload 隔离桥接层。Renderer 启用 sandbox 和 context isolation，只能通过 Preload 暴露的 `window.api` 访问文件系统和系统能力。

- [开发规范](AGENTS.md)
- [架构说明](docs/architecture.md)
- [会话运行时](docs/session-runtime-architecture.md)
- [内置 Skill 架构](src/main/skills/BUILTIN-SKILL-ARCHITECTURE.md)

## 发布说明

`npm run release` 仅上传当前版本 `latest-mac.yml` 引用的安装包及其关联 blockmap，上传前校验安装包大小和 SHA-512；旧版本文件可以保留在 `dist` 中。`SENTRY_DSN` 在构建时注入主进程产物，桌面启动无需另设环境变量；运行时显式提供的值可覆盖构建配置。

Tag Release 通过 GitHub Actions 导入 Developer ID 证书，并使用 electron-builder 内置流程完成 hardened runtime、签名和 notarization。签名使用 `CSC_LINK`、`CSC_KEY_PASSWORD`；notarization 使用 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`，或 Apple ID 方式的 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。仓库本地缺少发布证书时，`npm run pack` 仍会生成未签名的验证包；完整变量见 `.env.example`。
