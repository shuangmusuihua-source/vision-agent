# Design Token 最佳实践

## 一、项目启动清单

创建项目后、写第一个组件前，花 30 分钟做这些：

### 1. 建立 `tokens.css`，只放三件事

```css
:root {
  /* 色 — 8-10 个灰阶 + 3 个状态色，够用 */
  --gray-50: #fafaf9;
  --gray-900: #1c1917;
  /* ...中间档按需补 */

  /* 字 — 两族（正文 + 等宽），三档字号（小/中/大） */
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', Menlo, monospace;
  --text-sm: 12px;
  --text-md: 14px;
  --text-lg: 16px;

  /* 间距 — 4pt 基数，5 档起步 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
}
```

不需要一次定义全。**够当前页面用就停**，缺了再补。

### 2. 立即建立语义层

```css
:root {
  --color-bg:     var(--gray-50);
  --color-text:   var(--gray-900);
  --color-border: var(--gray-200);
}
```

这一步是关键 — 组件只引用语义层，不直接引用原始值。这样后续换色只需改映射，不动组件代码。

### 3. 暗色主题只改语义层映射

```css
[data-theme="dark"] {
  --color-bg:   #1e1e1e;
  --color-text: #e5e5e5;
}
```

组件代码零改动。

---

## 二、开发过程中的节奏

### 写组件时的规则

| 场景 | 做法 |
|------|------|
| 背景色、文字色、边框色 | 引用 `var(--color-bg)` / `var(--color-text)` / `var(--color-border)` |
| 字号 | 引用 `var(--text-sm)` 等，不写 `font-size: 13px` |
| 间距 | 引用 `var(--space-*)`，不写 `padding: 12px` |
| 圆角 | 引用 `var(--radius-*)`，不写 `border-radius: 8px` |
| 遇到 token 里没有的值 | 先补 token，再引用 |

### "先补 token"的判断标准

- 同一个值出现 **2 次** → 提取为 token
- 只出现 1 次，但属于**设计意图**（如"主操作色"）→ 提取为语义 token
- 只出现 1 次，纯视觉微调（如某个图标的 `top: -2px`）→ 硬编码即可

### Layer 3（组件 token）的生长时机

不要提前建。当你发现：

```
按钮 A 用了 var(--color-text) + var(--space-2) + var(--radius-sm)
按钮 B 也用了同样的组合
```

这时候才提取：

```css
--btn-primary-bg:    var(--color-text);
--btn-primary-text:  var(--color-bg);
--btn-primary-radius: var(--radius-sm);
```

---

## 三、命名规范

### 三层前缀约定

```
Layer 1  --color-gray-900       原始值，无业务含义
Layer 2  --color-text-primary   语义意图，组件直接用
Layer 3  --btn-primary-bg       组件专用，引用 Layer 2
```

### 命名公式

```
--{类别}-{属性}-{层级}

--color-bg-primary        类别=颜色，属性=背景，层级=主要
--font-size-md            类别=字体，属性=大小，层级=中
--space-lg                类别=间距，层级=大
--radius-md               类别=圆角，层级=中
--shadow-md               类别=阴影，层级=中
--duration-normal         类别=动效，层级=常规
```

### 避免的命名

```
--blue-500           ❌ 色值不是语义
--sidebar-width      ❌ 组件级命名放在了全局
--spacing-big        ❌ 模糊
```

---

## 四、文件组织

```
styles/
├── tokens.css        只放 :root 变量定义，不放任何样式规则
├── base.css          reset、html/body、滚动条等全局样式
├── components/       每个组件一个文件，引用 tokens
│   ├── button.css
│   ├── input.css
│   └── modal.css
```

`tokens.css` 是唯一修改变量值的地方。其他文件只消费，不定义。

---

## 五、暗色主题的维护原则

**只改 Layer 2 映射，不动 Layer 1 和 Layer 3：**

```css
/* ✅ 正确 */
[data-theme="dark"] {
  --color-bg:   #1e1e1e;    /* 改映射 */
  --color-text: #e5e5e5;
}

/* ❌ 错误 */
[data-theme="dark"] {
  --gray-900: #e5e5e5;      /* 不要改原始值 */
  --btn-primary-bg: #333;   /* 不要改组件 token，它引用语义层会自动联动 */
}
```

---

## 六、自检清单

每次提交前扫一眼：

- [ ] 新增的样式里有没有硬编码的色值（`#xxx`、`rgb()`）？→ 提取为 token
- [ ] 有没有直接引用 Layer 1 原始值（`var(--gray-900)`）？→ 改为语义层引用
- [ ] 暗色主题下有没有单独给组件写覆盖样式？→ 检查是否应该改语义层映射
- [ ] 新增的 token 有没有放在 `tokens.css`？→ 集中管理

---

## 七、让 AI Agent 遵守 Token 规范

AI 编码助手（Claude Code、Copilot 等）不会自动遵循设计系统，需要显式告知。

### 方式一：写进 CLAUDE.md（项目级，最直接）

项目根目录的 `CLAUDE.md` 每次对话自动加载。加一段规则：

```markdown
## Design Token 规则

- 所有颜色、字号、间距、圆角必须引用 CSS 变量，禁止硬编码
- 组件只引用语义层（--color-bg-primary），不直接引用原始层（--gray-50）
- 暗色主题只改语义层映射，不改原始值和组件 token
- 新增样式值出现 2 次以上时提取为 token
- token 定义集中在 tokens.css，其他文件只消费
```

AI 每次对话都会读取并遵守。

### 方式二：写进全局 Memory（跨项目生效）

用 `/remember` 把规则存到全局记忆，所有项目都能继承：

```
/remember 新项目必须先建立 Design Token 三层体系：原始层、语义层、组件层。组件只引用语义层，暗色只改映射，token 集中管理。
```

### 方式三：做成可复用的项目模板（最系统）

把 `tokens.css` 骨架和本文档放进模板仓库。新项目从模板创建，AI 读取到现成的 token 文件和规范文档，自然按这套体系工作。

### 推荐组合

**方式一 + 方式二。** CLAUDE.md 管项目级约束，Memory 管跨项目的通用原则。方式三适合频繁起新项目的场景。

---

## 八、团队协作

如果多人开发，加一条规则：**token 的增删改需要同步告知**。最简单的做法是在 PR 描述里标注 `tokens: +3/-1/~2`，让 reviewer 知道设计系统有变动。

---

**总结：先建骨架，只引用不硬编码，按需生长，暗色只改映射。** 这四条守住，token 系统就不会失控。
