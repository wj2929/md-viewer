/**
 * Markdown 内容区右键菜单处理器
 * @module markdownMenuHandler
 * @description v1.3 阶段 2 - Markdown 预览区右键菜单
 */

import { BrowserWindow, Menu } from 'electron'
import { validatePath } from './security'

/**
 * Markdown 菜单上下文
 */
export interface MarkdownMenuContext {
  filePath: string
  hasSelection: boolean
}

/**
 * 显示 Markdown 内容区右键菜单
 * @param window - 窗口实例
 * @param ctx - Markdown 上下文信息
 */
export function showMarkdownContextMenu(window: BrowserWindow, ctx: MarkdownMenuContext): void {
  // ⚠️ 安全校验
  validatePath(ctx.filePath)

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: '导出 HTML',
      accelerator: 'CmdOrCtrl+E',
      click: () => window.webContents.send('markdown:export-html')
    },
    {
      label: '导出 PDF',
      accelerator: 'CmdOrCtrl+Shift+E',
      click: () => window.webContents.send('markdown:export-pdf')
    },
    { type: 'separator' },
    {
      label: '复制为 Markdown',
      click: () => window.webContents.send('markdown:copy-source')
    },
    {
      label: '复制为纯文本',
      click: () => window.webContents.send('markdown:copy-plain-text')
    },
    {
      label: '复制为 HTML',
      click: () => window.webContents.send('markdown:copy-html')
    }
  ]

  // 如果有选中内容，添加复制选中内容选项
  if (ctx.hasSelection) {
    menuTemplate.push(
      { type: 'separator' },
      {
        label: '复制选中内容',
        accelerator: 'CmdOrCtrl+C',
        click: () => window.webContents.copy()
      }
    )
  }

  const menu = Menu.buildFromTemplate(menuTemplate)
  menu.popup({ window })
}
