# macOS 窗口失焦时 Traffic Light 按钮消失

## 问题

应用窗口失焦时，macOS 红绿灯按钮（关闭/最小化/最大化）不像其他原生应用那样变灰，而是直接消失不可见。

## 根因分析

macOS 根据应用主题推断失焦时 traffic light 按钮的颜色。当 macOS 认为应用是深色主题时，失焦按钮会用深色背景上的灰色渲染——在浅色背景上就"隐形"了。

问题链条：

1. 应用没有设置 `nativeTheme.themeSource`，macOS 自动推断应用主题
2. 应用的 CSS 使用半透明背景 + `backdrop-filter`，macOS 可能误判为深色主题
3. 失焦时 macOS 用深色主题的灰色渲染按钮，浅灰色按钮在浅色背景上不可见
4. 这不是 CSS 问题，改背景色/去掉 backdrop-filter 无法解决根因

Electron 官方 issue [#44034](https://github.com/electron/electron/issues/44034) 确认这是 macOS 行为，Electron 无法直接控制按钮渲染颜色。

## 修复

设置 `nativeTheme.themeSource` 与用户选择的主题同步，让 macOS 正确推断应用主题：

- 浅色模式 → `nativeTheme.themeSource = 'light'`
- 深色模式 → `nativeTheme.themeSource = 'dark'`
- 跟随系统 → `nativeTheme.themeSource = 'system'`（让 macOS 自动推断）

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/index.ts` | 导入 `nativeTheme` 和 `getSettings`，启动时根据存储的 theme 初始化 `nativeTheme.themeSource` |
| `src/main/ipc-handlers.ts` | 导入 `nativeTheme`，在 `settings:setTheme` handler 中同步更新 `nativeTheme.themeSource` |

## 关键代码

```ts
// index.ts — 启动时初始化
import { app, BrowserWindow, nativeTheme } from 'electron'
import { getSettings } from './store'

app.whenReady().then(() => {
  const savedTheme = getSettings().theme
  if (savedTheme !== 'system') {
    nativeTheme.themeSource = savedTheme
  }
  // ...
})
```

```ts
// ipc-handlers.ts — 主题切换时同步
import { ipcMain, nativeTheme } from 'electron'

ipcMain.handle('settings:setTheme', (_event, theme: 'light' | 'dark' | 'system') => {
  setTheme(theme)
  if (theme === 'system') {
    nativeTheme.themeSource = 'system'
  } else {
    nativeTheme.themeSource = theme
  }
  return { success: true }
})
```
