import { app, Menu, shell } from 'electron'

export function setupMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: `About ${app.name}`, role: 'about' },
              { type: 'separator' },
              { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: sendMenuAction('open-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: sendMenuAction('save-file') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: sendMenuAction('toggle-sidebar') },
        { label: 'Toggle Agent Panel', accelerator: 'CmdOrCtrl+Shift+B', click: sendMenuAction('toggle-agent-panel') },
        { type: 'separator' },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: sendMenuAction('open-search') },
        { type: 'separator' },
        { label: 'Source Mode', accelerator: 'CmdOrCtrl+/', click: sendMenuAction('toggle-source-mode') },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+\\', click: sendMenuAction('toggle-focus-mode') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/shuangmusuihua-source/vision-agent')
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