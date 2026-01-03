/**
 * 右键菜单处理器
 * @module contextMenuHandler
 * @description 处理文件树右键菜单的显示和操作
 */

import { Menu, shell, clipboard, BrowserWindow } from 'electron'
import * as path from 'path'
import { validatePath, validateSecurePath } from './security'

/**
 * 文件信息接口
 */
interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
}

/**
 * 显示文件/文件夹的右键菜单
 * @param window - 主窗口实例
 * @param file - 文件信息
 * @param basePath - 项目根目录路径
 */
export function showContextMenu(
  window: BrowserWindow,
  file: FileInfo,
  basePath: string
): void {
  const platform = process.platform

  // 菜单文案国际化
  const i18n = {
    showInFolder:
      platform === 'darwin'
        ? '在 Finder 中显示'
        : platform === 'win32'
        ? '在资源管理器中显示'
        : '在文件管理器中显示',
    copyPath: '复制路径',
    copyRelativePath: '复制相对路径',
    copy: '复制',
    cut: '剪切',
    paste: '粘贴',
    rename: '重命名',
    delete: '删除',
    exportHTML: '导出 HTML',
    exportPDF: '导出 PDF',
    separator: 'separator' as const
  }

  const template: Array<Electron.MenuItemConstructorOptions> = [
    // 在文件管理器中显示
    {
      label: i18n.showInFolder,
      click: async () => {
        try {
          validatePath(file.path)
          shell.showItemInFolder(file.path)
        } catch (error) {
          console.error('Failed to show item in folder:', error)
          window.webContents.send('error:show', {
            message: error instanceof Error ? error.message : '无法显示文件'
          })
        }
      }
    },
    { type: 'separator' },
    // 复制路径
    {
      label: i18n.copyPath,
      accelerator: 'CmdOrCtrl+Alt+C',
      click: () => {
        clipboard.writeText(file.path)
      }
    },
    // 复制相对路径
    {
      label: i18n.copyRelativePath,
      accelerator: 'Shift+Alt+C',
      click: () => {
        const relativePath = path.relative(basePath, file.path)
        clipboard.writeText(relativePath)
      }
    },
    { type: 'separator' },
    // 复制（应用内剪贴板 - v1.2 阶段 2）
    {
      label: i18n.copy,
      accelerator: 'CmdOrCtrl+C',
      enabled: true, // v1.2 阶段 2 已启用
      click: () => {
        window.webContents.send('clipboard:copy', [file.path])
      }
    },
    // 剪切（应用内剪贴板 - v1.2 阶段 2）
    {
      label: i18n.cut,
      accelerator: 'CmdOrCtrl+X',
      enabled: true, // v1.2 阶段 2 已启用
      click: () => {
        window.webContents.send('clipboard:cut', [file.path])
      }
    },
    // 粘贴（仅文件夹）
    ...(file.isDirectory
      ? [
          {
            label: i18n.paste,
            accelerator: 'CmdOrCtrl+V' as const,
            enabled: true, // v1.2 阶段 2 已启用
            click: () => {
              window.webContents.send('clipboard:paste', file.path)
            }
          }
        ]
      : []),
    { type: 'separator' },
    // 导出功能（仅文件）
    ...(!file.isDirectory
      ? [
          {
            label: i18n.exportHTML,
            click: async () => {
              try {
                validatePath(file.path)
                // 发送事件给渲染进程处理
                window.webContents.send('file:export-request', {
                  path: file.path,
                  type: 'html'
                })
              } catch (error) {
                console.error('Failed to request HTML export:', error)
                window.webContents.send('error:show', {
                  message: error instanceof Error ? error.message : '无法导出 HTML'
                })
              }
            }
          },
          {
            label: i18n.exportPDF,
            click: async () => {
              try {
                validatePath(file.path)
                // 发送事件给渲染进程处理
                window.webContents.send('file:export-request', {
                  path: file.path,
                  type: 'pdf'
                })
              } catch (error) {
                console.error('Failed to request PDF export:', error)
                window.webContents.send('error:show', {
                  message: error instanceof Error ? error.message : '无法导出 PDF'
                })
              }
            }
          },
          { type: 'separator' as const }
        ]
      : []),
    // 重命名
    {
      label: i18n.rename,
      accelerator: 'Enter',
      click: () => {
        window.webContents.send('file:start-rename', file.path)
      }
    },
    // 删除
    {
      label: i18n.delete,
      accelerator: platform === 'darwin' ? 'Cmd+Backspace' : 'Delete',
      click: async () => {
        try {
          validateSecurePath(file.path)
          // 移到回收站
          await shell.trashItem(file.path)
          // 通知渲染进程文件已删除
          window.webContents.send('file:deleted', file.path)
        } catch (error) {
          console.error('Failed to delete file:', error)
          window.webContents.send('error:show', {
            message: error instanceof Error ? error.message : '无法删除文件'
          })
        }
      }
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  menu.popup({ window })
}
