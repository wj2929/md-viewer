import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

interface ApplicationMenuHandlers {
  openSettings: () => void | Promise<void>
}

function buildWindowMenu(): MenuItemConstructorOptions {
  return {
    label: '窗口',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { role: 'close' },
    ],
  }
}

export function createMacApplicationMenuTemplate(handlers: ApplicationMenuHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: app?.name || 'MD Viewer',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: '设置...',
          accelerator: 'CommandOrControl+,',
          click: () => {
            void handlers.openSettings()
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
    { role: 'help', submenu: [] },
  ]
}

export function installApplicationMenu(): void {
  const handlers: ApplicationMenuHandlers = {
    openSettings: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('shortcut:settings')
    },
  }

  const template: MenuItemConstructorOptions[] = process.platform === 'darwin'
    ? createMacApplicationMenuTemplate(handlers)
    : [
        { label: app?.name || 'MD Viewer', submenu: [{ role: 'quit' }] },
        { role: 'editMenu' },
        buildWindowMenu(),
      ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
