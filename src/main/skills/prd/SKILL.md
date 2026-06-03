---
name: prd
description: 'Generate structured Product Requirement Documents (PRD) following the five-part template. Triggers on "/prd", "写PRD", "产品需求文档", "需求文档".'
---

# PRD Generator

Generate structured Product Requirement Documents. Follow the five-part template and three-stage iteration process.

**Output artifact**: Write the PRD to `<workspace>/.vision/prd/<project-name>.md`. After writing, present a brief summary in chat. Create the `.vision/prd/` directory if it doesn't exist.

## Core Rules

- **Think before writing.** Every ambiguity in the PRD causes AI to guess — guessing produces bugs.
- **One question at a time.** Never bombard with multiple questions.
- **Stage gates.** After each stage, pause and wait for user confirmation before proceeding. Never barrel through all stages without feedback.
- **Reply in the user's language.** Match the language the user uses.
- **Iteration is welcome.** If the user says "go back to Stage 2" or "revise the user stories", treat it as a normal iteration, not an error.

## Conversational Opener

When invoked, open with a friendly one-liner like: "好的，我来帮你梳理产品需求。先聊几个关键问题，一个一个来。"

## Workflow

### Stage 0 — Clarify

Gather context one question at a time. **Smart skip**: If the user's opening message already contains the product description, target users, pain points, and MVP scope, DON'T re-ask. Instead, extract and confirm with a summary: "我理解你描述的是：<summary>。确认无误的话我们直接开始写初稿？"

If information is missing, ask in this order, ONE at a time:

1. **这个产品是做什么的？一句话描述即可。**
2. **目标用户是谁？他们的典型画像是什么？**
3. **核心痛点是什么？为什么现有方案不够好？**
4. **MVP 第一期必须做哪些功能？哪些可以后续迭代？**

After each answer, briefly acknowledge before asking the next. If any answer is too vague, ask one follow-up.

**Gate**: After collecting all four, confirm: "我整理一下：产品是<X>，目标用户是<Y>，核心痛点是<Z>，MVP 范围是<W>。确认无误的话，我开始写初稿？"

### Stage 1 — 初稿 (Why)

Focus on background and goals. Write to `<workspace>/.vision/prd/<name>.md`:

- **文档信息**: version v0.1, stage 初稿, date, stakeholders
- **项目背景**: one-paragraph overview
- **核心问题**: what problem, why existing solutions fail
- **用户故事**: `作为<角色>，我想要<任务>，以便于<价值>`. Include Given/When/Then acceptance criteria per story.
- **项目目标** (SMART): Specific, Measurable, Achievable, Relevant, Time-bound
- **范围定义**: 本期范围 / 明确不做 / 后续迭代 (table)
- **风险与假设**: Known risks, key assumptions, open questions

**Gate**: After writing, say: "初稿已完成，保存在 `<path>`。请确认背景、用户故事和范围是否正确。确认后我补充交互流程和方案设计。"

### Stage 2 — 中稿 (What)

Update the file. Add:

- **核心业务流程** (Mermaid diagram)
- **功能模块划分** (table: module, description, priority P0/P1/P2, status)
- **数据模型概要**: entity name, key fields, relationships (Markdown table)
- **页面/交互描述** (text descriptions, not visual designs)
- **边界场景处理**: empty state, error state, loading state, edge cases

**Gate**: After writing, say: "中稿已完成。请确认业务流程和功能模块是否正确。确认后我补充上线计划和最终细节。"

### Stage 3 — 定稿 (How)

Finalize. Add:

- **UI 设计要点** (关键页面的设计方向，不要求详细视觉稿)
- **非功能需求**: performance, security, compatibility
- **上线计划**: milestones, phased rollup, key metrics, rollback plan

After writing: "定稿完成。PRD 保存在 `<path>`。如需修改任何部分，直接告诉我。"

## PRD Template

### 一、文档信息

| 字段 | 内容 |
|------|------|
| 文档版本 | v0.1 |
| 当前阶段 | 初稿 / 中稿 / 定稿 |
| 创建日期 | YYYY-MM-DD |
| 负责人 | — |
| 迭代记录 | v0.1 初始版本 |

### 二、背景与目标

- **项目背景**: 一句话概述
- **核心问题**
- **用户故事**: 作为<角色>，我想要<任务>，以便于<价值>
  - Acceptance criteria (Given/When/Then)
- **项目目标** (SMART)
- **范围定义**:

| 类别 | 内容 |
|------|------|
| 本期范围 | — |
| 明确不做 | — |
| 后续迭代 | — |

- **风险与假设**:

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| — | — | — |

### 三、方案概述

- **核心业务流程** (Mermaid)
- **功能模块划分**:

| 模块 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| — | — | P0 | 待开发 |

- **数据模型概要**:

| 实体 | 关键字段 | 关联 |
|------|---------|------|
| — | — | — |

### 四、详细方案

- **页面/交互描述**
- **边界场景**: 空状态 / 错误状态 / 加载状态 / 极端数据
- **非功能需求**: 性能 / 安全 / 兼容性

### 五、上线计划

- **里程碑**
- **灰度策略**
- **监控指标**
- **回滚方案**

## User Story Format

`作为<角色>，我想要<完成任务>，以便于<实现价值>`

Each user story must include Given/When/Then acceptance criteria:

```
Given <前置条件>
When <用户操作>
Then <预期结果>
```
