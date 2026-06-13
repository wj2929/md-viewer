import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

interface ApplicationMenuHandlers {
  openSettings: () => void | Promise<void>
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
    { role: 'windowMenu' },
    { role: 'help', submenu: [] },
  ]
}

export function installApplicationMenu(): void {
  if (process.platform !== 'darwin') return

  const template = createMacApplicationMenuTemplate({
    openSettings: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('shortcut:settings')
    },
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
