import { BrowserWindow, ipcMain, dialog } from 'electron'
import { IPCContext } from './context'
import { setAllowedBasePath } from '../security'

export function registerWindowHandlers(ctx: IPCContext): void {
  // 获取当前窗口 ID
  ipcMain.handle('window:getWindowId', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? win.id : null
  })

  // 创建新窗口
  ipcMain.handle('window:newWindow', () => {
    const win = ctx.windowManager.createWindow()
    return win.id
  })

  // 创建新窗口并打开文件夹
  ipcMain.handle('window:newWindowWithFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    const win = ctx.windowManager.createWindow()

    ctx.windowManager.addPendingAction(win.id, () => {
      setAllowedBasePath(folderPath)
      ctx.store.set('lastOpenedFolder', folderPath)
      ctx.folderHistoryManager.addFolder(folderPath)
      win.webContents.send('restore-folder', folderPath)
    })

    return win.id
  })

  // 获取窗口数量
  ipcMain.handle('window:getWindowCount', () => {
    return ctx.windowManager.getWindowCount()
  })

  // 设置窗口置顶
  ipcMain.handle('window:setAlwaysOnTop', async (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setAlwaysOnTop(flag)
    ctx.store.set('alwaysOnTop', flag)
    return flag
  })

  // 获取窗口置顶状态
  ipcMain.handle('window:getAlwaysOnTop', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isAlwaysOnTop() ?? false
  })

  // 切换窗口置顶
  ipcMain.handle('window:toggleAlwaysOnTop', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const newState = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(newState)
    ctx.store.set('alwaysOnTop', newState)
    win.webContents.send('alwaysOnTop:changed', newState)
    return newState
  })

  // 设置全屏
  ipcMain.handle('window:setFullScreen', async (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setFullScreen(flag)
    return flag
  })

  // 获取全屏状态
  ipcMain.handle('window:isFullScreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  // 切换全屏
  ipcMain.handle('window:toggleFullScreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const newState = !win.isFullScreen()
    win.setFullScreen(newState)
    return newState
  })

  // 打印功能
  ipcMain.handle('window:print', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false }

    win.webContents.print({
      silent: false,
      printBackground: true,
      margins: {
        marginType: 'default'
      }
    })
    return { success: true }
  })
}
