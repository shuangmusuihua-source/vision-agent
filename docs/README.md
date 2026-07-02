# Documentation

这里仅保留描述当前实现且会持续维护的文档：

- [`../AGENTS.md`](../AGENTS.md) — 开发规范与代码约束，唯一规范来源
- [`../README.md`](../README.md) — 产品、开发和打包入口
- [`architecture.md`](architecture.md) — 当前模块边界与数据流
- [`session-runtime-architecture.md`](session-runtime-architecture.md) — 会话身份、并发和事件路由
- [`../src/main/skills/BUILTIN-SKILL-ARCHITECTURE.md`](../src/main/skills/BUILTIN-SKILL-ARCHITECTURE.md) — 内置 Skill 维护流程

## 维护规则

1. 文档描述“当前实现”时，必须链接到实际模块，不能保留已删除文件或旧模块名。
2. Roadmap、一次性修复记录和审计快照不作为长期文档；完成或失效后依赖 Git 历史追溯。
3. 外部 SDK 文档不复制进仓库。涉及 SDK 行为时，以当前依赖版本的官方文档和类型定义为准。
4. 架构重构、IPC 变更、持久化边界变化和发布流程变化必须同步更新对应文档。
