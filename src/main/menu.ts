import { app, Menu, shell } from 'electron'
import { GITHUB_REPOSITORY_URL } from '../shared/branding'

export function setupMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { label: `About ${app.getName()}`, role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', sublabel: '打开设置面板', click: sendMenuAction('open-settings') },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ] as Electron.MenuItemConstructorOptions[]
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Save', accelerator: 'CmdOrCtrl+S', sublabel: '保存当前文件', click: sendMenuAction('save-file') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', sublabel: '显示/隐藏侧边栏', click: sendMenuAction('toggle-sidebar') },
        { label: 'Toggle Agent Panel', accelerator: 'CmdOrCtrl+Shift+B', sublabel: '显示/隐藏 Agent 面板', click: sendMenuAction('toggle-agent-panel') },
        { type: 'separator' as const },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', sublabel: '搜索文件内容', click: sendMenuAction('open-search') },
        { type: 'separator' as const },
        { label: 'Source Mode', accelerator: 'CmdOrCtrl+/', sublabel: '切换源码视图', click: sendMenuAction('toggle-source-mode') },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+\\', sublabel: '切换专注模式', click: sendMenuAction('toggle-focus-mode') },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        { role: 'toggleDevTools' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal(GITHUB_REPOSITORY_URL)
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function sendMenuAction(action: string): () => void {
  return () => {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.webContents.send('menu-action', action)
    }
  }
}
