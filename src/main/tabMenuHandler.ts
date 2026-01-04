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
}

/**
 * 显示 Tab 右键菜单
 * @param window - 窗口实例
 * @param ctx - Tab 上下文信息
 */
export function showTabContextMenu(window: BrowserWindow, ctx: TabMenuContext): void {
  const { tabId, filePath, basePath, tabCount, tabIndex } = ctx

  const menu = Menu.buildFromTemplate([
    {
      label: '关闭',
      accelerator: 'CmdOrCtrl+W',
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
      label: '在 Finder 中显示',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: () => {
        try {
          shell.showItemInFolder(filePath)
        } catch (error) {
          console.error('[TAB_MENU] Failed to show in folder:', error)
          window.webContents.send('error:show', {
            message: `无法在 Finder 中显示：${error instanceof Error ? error.message : '未知错误'}`
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
