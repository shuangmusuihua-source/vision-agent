# 空 MD 文件无法编辑问题修复

## 问题

新建的空 md 文件在 Tiptap 编辑器中无法进入编辑状态：
- 点击编辑区域没有光标
- 无法输入任何文字
- 鼠标样式保持普通指针，不变为文本光标

## 根因分析

涉及 4 个层面的问题：

### 1. 初始内容格式

Tiptap 基于 ProseMirror，空字符串 `""` 会导致文档结构节点丢失。Markdown 扩展的 `parse("")` 返回 `{ content: [] }`，空数组 falsy，扩展不会替换内容，编辑器没有段落节点。

**修复**：初始内容用 `<p></p>` 替代空字符串，确保 ProseMirror 挂载空段落节点。

### 2. 容器宽度收缩

`.editor-wrapper` 使用 `display: flex; justify-content: center` 实现编辑器居中。当内容为空时，`.ProseMirror` 容器宽度随内容收缩为 0，被 flex 居中后，光标出现在页面中央，且只能从中间开始输入。

**修复**：移除 flex 居中，改用 block 布局 + `margin: 0 auto` 实现居中。`.ProseMirror` 设 `width: 100%`，始终占满 `max-width: 800px`。

### 3. 空白区域不可点击

空编辑器没有内容区域，用户点击空白处无法触发光标。

**修复**：
- `.ProseMirror` 设 `min-height: 300px`，确保有可点击区域
- `editorProps.handleClick` 在点击时自动聚焦

### 4. 无视觉提示

空编辑器没有任何提示，用户不知道可以输入。

**修复**：安装 `@tiptap/extension-placeholder`，空文档显示"开始输入..."占位文字。

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/renderer/components/editor/MarkdownEditor.tsx` | 初始内容改为 `<p></p>`，添加 Placeholder 扩展，添加 handleClick 聚焦 |
| `src/renderer/styles/editor.css` | `.ProseMirror` 添加 min-height/width/text-align，`.editor-wrapper` 移除 flex 改用 block + margin auto，`.markdown-editor` 添加 margin: 0 auto |
| `package.json` | 添加 `@tiptap/extension-placeholder` 依赖 |

## 关键代码

```tsx
// MarkdownEditor.tsx
import Placeholder from '@tiptap/extension-placeholder'

// useEditor extensions
Placeholder.configure({ placeholder: '开始输入...' })

// editorProps
editorProps: {
  handleClick: (view, pos) => {
    if (!view.hasFocus()) view.focus()
  }
}

// 初始内容
content: content || '<p></p>'
```

```css
/* editor.css */
.ProseMirror {
  min-height: 300px;
  outline: none;
  text-align: left;
  width: 100%;
}

.editor-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  /* 不用 display: flex; justify-content: center */
}

.markdown-editor {
  max-width: 800px;
  width: 100%;
  margin: 0 auto; /* block 居中 */
}
```
