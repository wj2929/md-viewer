/**
 * Tab 右键菜单处理器
 * @module tabMenuHandler
 * @description v1.3 新增 - 处理标签页右键菜单
 */

import { BrowserWindow, Menu, shell, clipboard } from 'electron'
import * as path from 'path'

/**
 * Tab 菜单上下文
 */
export interface TabMenuContext {
  tabId: string
  filePath: string
  basePath: string
  tabCount: number   // 用于动态启用菜单项
  tabIndex: number   // 用于动态启用菜单项
  isPinned?: boolean // v1.3.6 新增：是否已固定
}

/**
 * 显示 Tab 右键菜单
 * @param window - 窗口实例
 * @param ctx - Tab 上下文信息
 */
export function showTabContextMenu(window: BrowserWindow, ctx: TabMenuContext): void {
  const { tabId, filePath, basePath, tabCount, tabIndex, isPinned } = ctx

  const menu = Menu.buildFromTemplate([
    // v1.3.6：固定/取消固定
    {
      label: isPinned ? '取消固定' : '固定此标签',
      click: () => window.webContents.send(isPinned ? 'tab:unpin' : 'tab:pin', tabId)
    },
    // v1.3.6：添加到书签
    {
      label: '添加到书签',
      accelerator: 'CmdOrCtrl+D',
      click: () => window.webContents.send('tab:add-bookmark', { tabId, filePath })
    },
    { type: 'separator' },
    {
      label: '关闭',
      accelerator: 'CmdOrCtrl+W',
      enabled: !isPinned,  // v1.3.6：固定标签不能直接关闭
      click: () => window.webContents.send('tab:close', tabId)
    },
    {
      label: '关闭其他标签',
      enabled: tabCount > 1,
      click: () => window.webContents.send('tab:close-others', tabId)
    },
    {
      label: '关闭所有标签',
      enabled: tabCount > 0,
      click: () => window.webContents.send('tab:close-all')
    },
    { type: 'separator' },
    {
      label: '关闭左侧标签',
      enabled: tabIndex > 0,
      click: () => window.webContents.send('tab:close-left', tabId)
    },
    {
      label: '关闭右侧标签',
      enabled: tabIndex < tabCount - 1,
      click: () => window.webContents.send('tab:close-right', tabId)
    },
    { type: 'separator' },
    {
      label: process.platform === 'darwin' ? '在 Finder 中显示' : process.platform === 'win32' ? '在资源管理器中显示' : '在文件管理器中显示',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: () => {
        const folderLabel = process.platform === 'darwin' ? 'Finder' : process.platform === 'win32' ? '资源管理器' : '文件管理器'
        try {
          shell.showItemInFolder(filePath)
        } catch (error) {
          console.error('[TAB_MENU] Failed to show in folder:', error)
          window.webContents.send('error:show', {
            message: `无法在 ${folderLabel} 中显示：${error instanceof Error ? error.message : '未知错误'}`
          })
        }
      }
    },
    {
      label: '复制文件路径',
      click: () => {
        clipboard.writeText(filePath)
        console.log('[TAB_MENU] Copied absolute path:', filePath)
      }
    },
    {
      label: '复制相对路径',
      click: () => {
        const relativePath = path.relative(basePath, filePath)
        clipboard.writeText(relativePath)
        console.log('[TAB_MENU] Copied relative path:', relativePath)
      }
    }
  ])

  menu.popup({ window })
}
