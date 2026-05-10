import { BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, clipboard, shell } from 'electron'
import * as path from 'path'
import { IPCContext } from './context'
import { setAllowedBasePath, getAllowedBasePath, isPathAllowed, validatePath } from '../security'
import { showContextMenu } from '../contextMenuHandler'
import { showTabContextMenu, TabMenuContext } from '../tabMenuHandler'
import { showMarkdownContextMenu, MarkdownMenuContext } from '../markdownMenuHandler'
import { appDataManager } from '../appDataManager'
import { getLastDocxExportPath } from './exportHandlers'
import * as fs from 'fs'

// 文件信息接口（与 fileHandlers 共享）
interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  children?: FileInfo[]
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])

function isMarkdownFilePath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function registerMenuHandlers(ctx: IPCContext): void {
// ============== 右键菜单 Handlers ==============

// 显示文件树右键菜单
ipcMain.handle('context-menu:show', async (event, file: FileInfo, basePath: string) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showContextMenu(window, file, basePath)
  return { success: true }
})

// v1.3 新增：显示 Tab 右键菜单
ipcMain.handle('tab:show-context-menu', async (event, ctx: TabMenuContext) => {
  // ⚠️ 安全校验（安全审计师要求）
  validatePath(ctx.filePath)
  validatePath(ctx.basePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showTabContextMenu(window, ctx)
  return { success: true }
})

// v1.3 阶段 2：显示 Markdown 右键菜单
ipcMain.handle('markdown:show-context-menu', async (event, ctx: MarkdownMenuContext) => {
  // ⚠️ 安全校验
  validatePath(ctx.filePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showMarkdownContextMenu(window, ctx)
  return { success: true }
})

// 书签右键菜单（BookmarkBar / BookmarkPanel）
ipcMain.handle('context-menu:bookmark', (_event, bookmark: {
  id: string
  filePath: string
  fileName: string
  headingText?: string
}) => {
  const window = BrowserWindow.fromWebContents(_event.sender)
  if (!window) return

  // 书签可能跨文件夹，分屏打开前需要扩展安全路径
  const ensurePathAllowed = (filePath: string): void => {
    if (!isPathAllowed(filePath)) {
      const currentBase = getAllowedBasePath()
      const fileDir = path.dirname(filePath)
      if (currentBase) {
        // 找到公共祖先路径
        const currentParts = currentBase.split(path.sep)
        const fileParts = fileDir.split(path.sep)
        const commonParts: string[] = []
        for (let i = 0; i < Math.min(currentParts.length, fileParts.length); i++) {
          if (currentParts[i] === fileParts[i]) {
            commonParts.push(currentParts[i])
          } else break
        }
        const commonAncestor = commonParts.join(path.sep) || path.sep
        setAllowedBasePath(commonAncestor)
      } else {
        setAllowedBasePath(fileDir)
      }
    }
  }

  const menu = Menu.buildFromTemplate([
    {
      label: '📐 在分屏中打开',
      submenu: [
        {
          label: '向右分屏',
          click: () => {
            ensurePathAllowed(bookmark.filePath)
            window.webContents.send('file:open-in-split', {
              filePath: bookmark.filePath,
              direction: 'horizontal'
            })
          }
        },
        {
          label: '向下分屏',
          click: () => {
            ensurePathAllowed(bookmark.filePath)
            window.webContents.send('file:open-in-split', {
              filePath: bookmark.filePath,
              direction: 'vertical'
            })
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: '🗑️ 删除书签',
      click: () => window.webContents.send('bookmark:delete', bookmark.id)
    }
  ])

  menu.popup({ window })
})

// 最近文件右键菜单
ipcMain.handle('context-menu:recent-file', (_event, file: {
  filePath: string
  fileName: string
}) => {
  const window = BrowserWindow.fromWebContents(_event.sender)
  if (!window) return

  // 最近文件可能跨文件夹，分屏打开前需要扩展安全路径
  const ensurePathAllowed = (filePath: string): void => {
    if (!isPathAllowed(filePath)) {
      const currentBase = getAllowedBasePath()
      const fileDir = path.dirname(filePath)
      if (currentBase) {
        const currentParts = currentBase.split(path.sep)
        const fileParts = fileDir.split(path.sep)
        const commonParts: string[] = []
        for (let i = 0; i < Math.min(currentParts.length, fileParts.length); i++) {
          if (currentParts[i] === fileParts[i]) {
            commonParts.push(currentParts[i])
          } else break
        }
        const commonAncestor = commonParts.join(path.sep) || path.sep
        setAllowedBasePath(commonAncestor)
      } else {
        setAllowedBasePath(fileDir)
      }
    }
  }

  const menu = Menu.buildFromTemplate([
    {
      label: '📐 在分屏中打开',
      submenu: [
        {
          label: '向右分屏',
          click: () => {
            ensurePathAllowed(file.filePath)
            window.webContents.send('file:open-in-split', {
              filePath: file.filePath,
              direction: 'horizontal'
            })
          }
        },
        {
          label: '向下分屏',
          click: () => {
            ensurePathAllowed(file.filePath)
            window.webContents.send('file:open-in-split', {
              filePath: file.filePath,
              direction: 'vertical'
            })
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: '🗑️ 从历史中移除',
      click: () => window.webContents.send('recent-file:remove', file.filePath)
    }
  ])

  menu.popup({ window })
})

// v1.3.7：预览区域右键菜单（添加书签 + 原有功能）
// v1.4.0：新增页面内搜索和查看快捷键入口
// v1.4.2：新增打印和字体大小调节
ipcMain.handle('preview:show-context-menu', async (event, params: {
  filePath: string
  tabId?: string
  leafId?: string | null
  headingId: string | null
  headingText: string | null
  headingLevel: string | null
  hasSelection: boolean
  selectionText?: string
  sourceLine?: number | null
  scrollRatio?: number | null
  linkHref: string | null
  basePath: string | null
}) => {
  // ⚠️ 安全校验：分屏场景下文件可能来自不同文件夹，需要扩展安全路径
  if (!isPathAllowed(params.filePath)) {
    const currentBase = getAllowedBasePath()
    const fileDir = path.dirname(params.filePath)
    if (currentBase) {
      // 找到公共祖先路径（与书签菜单逻辑一致）
      const currentParts = currentBase.split(path.sep)
      const fileParts = fileDir.split(path.sep)
      const commonParts: string[] = []
      for (let i = 0; i < Math.min(currentParts.length, fileParts.length); i++) {
        if (currentParts[i] === fileParts[i]) {
          commonParts.push(currentParts[i])
        } else break
      }
      const commonAncestor = commonParts.join(path.sep) || path.sep
      setAllowedBasePath(commonAncestor)
    } else {
      setAllowedBasePath(fileDir)
    }
  }
  validatePath(params.filePath)

  const {
    filePath,
    tabId,
    leafId,
    headingId,
    headingText,
    headingLevel,
    hasSelection,
    selectionText,
    sourceLine,
    scrollRatio,
    linkHref,
    basePath
  } = params
  const isMarkdownPreview = isMarkdownFilePath(filePath)

  const menuTemplate: MenuItemConstructorOptions[] = []

  // v1.3.7: 书签功能
  // 如果右键点击的是标题，添加"添加标题书签"
  if (isMarkdownPreview && headingId && headingText) {
    menuTemplate.push({
      label: '🔖 添加标题书签',
      click: () => {
        event.sender.send('add-bookmark-from-preview', {
          filePath,
          headingId,
          headingText
        })
      }
    })
  }

  if (isMarkdownPreview) {
    // 添加"添加文件书签"
    menuTemplate.push({
      label: '📄 添加文件书签',
      click: () => {
        event.sender.send('add-bookmark-from-preview', {
          filePath,
          headingId: null,
          headingText: null
        })
      }
    })

    menuTemplate.push({ type: 'separator' })

    const quickEditMode = selectionText?.trim()
      ? 'selection'
      : typeof sourceLine === 'number'
        ? 'source-line'
        : typeof scrollRatio === 'number'
          ? 'scroll-ratio'
          : 'document'
    const quickEditTarget = {
      filePath,
      ...(tabId ? { tabId } : {}),
      ...(leafId ? { leafId } : {}),
      ...(selectionText?.trim() ? { targetText: selectionText.trim() } : {}),
      ...(typeof sourceLine === 'number' ? { targetLine: sourceLine, sourceLine } : {}),
      ...(typeof scrollRatio === 'number' ? { scrollRatio } : {}),
      mode: quickEditMode,
    }

    // 轻量编辑：弱入口，放在预览区右键菜单中，避免占用正文工具栏空间
    menuTemplate.push({
      label: quickEditMode === 'document' ? '✏️ 快速编辑' : '🎯 快速编辑此处',
      click: () => event.sender.send('markdown:quick-edit', quickEditTarget)
    })

    menuTemplate.push({ type: 'separator' })
  }

  // v1.5.1+: 链接相关菜单项（仅在右键点击 .md 链接时显示）
  if (isMarkdownPreview && linkHref) {
    const dir = path.dirname(filePath)
    const targetPath = path.resolve(dir, linkHref)
    const linkFileName = path.basename(targetPath)

    menuTemplate.push({
      label: `📂 打开 ${linkFileName}`,
      click: () => {
        ctx.openPathInWindow(targetPath, 'md-file')
      }
    })
    menuTemplate.push({
      label: '📐 在分屏中打开',
      submenu: [
        {
          label: '向右分屏',
          click: () => {
            event.sender.send('file:open-in-split', {
              filePath: targetPath,
              direction: 'horizontal'
            })
          }
        },
        {
          label: '向下分屏',
          click: () => {
            event.sender.send('file:open-in-split', {
              filePath: targetPath,
              direction: 'vertical'
            })
          }
        }
      ]
    })
    menuTemplate.push({ type: 'separator' })
  }

  // v1.4.0: 页面内搜索（可点击触发）
  menuTemplate.push({
    label: '🔍 页面内搜索',
    accelerator: 'CmdOrCtrl+Shift+F',
    click: () => {
      event.sender.send('shortcut:open-in-page-search')
    }
  })

  menuTemplate.push({ type: 'separator' })

  // v1.3 原有功能：导出功能
  menuTemplate.push({
    label: '📤 导出 HTML',
    accelerator: 'CmdOrCtrl+E',
    click: () => event.sender.send('markdown:export-html')
  })

  menuTemplate.push({
    label: '📑 导出 PDF',
    accelerator: 'CmdOrCtrl+Shift+E',
    click: () => event.sender.send('markdown:export-pdf')
  })

  // Word 导出：根据 docxExport 设置条件显示
  const docxConfig = appDataManager.getSettings().docxExport
  const docxVisible = docxConfig?.remoteEnabled || docxConfig?.localFallbackEnabled
  if (docxVisible) {
    menuTemplate.push({
      label: docxConfig?.remoteEnabled ? '📝 导出 Word' : '📝 导出 Word（离线）',
      click: () => event.sender.send('markdown:export-docx')
    })
  }

  const lastExportPath = getLastDocxExportPath()
  if (lastExportPath && fs.existsSync(lastExportPath)) {
    const lastExportName = path.basename(lastExportPath)
    menuTemplate.push({
      label: `📎 上次导出：${lastExportName}`,
      submenu: [
        { label: '打开文件', click: () => shell.openPath(lastExportPath!) },
        { label: '在 Finder 中显示', click: () => shell.showItemInFolder(lastExportPath!) },
      ]
    })
  }

  // v1.4.2：打印功能
  menuTemplate.push({
    label: '🖨️ 打印',
    accelerator: 'CmdOrCtrl+P',
    click: () => event.sender.send('shortcut:print')
  })

  menuTemplate.push({ type: 'separator' })

  // v1.4.2：字体大小调节（子菜单）
  menuTemplate.push({
    label: '🔤 字体大小',
    submenu: [
      {
        label: '放大',
        accelerator: 'CmdOrCtrl+Plus',
        click: () => event.sender.send('shortcut:font-increase')
      },
      {
        label: '缩小',
        accelerator: 'CmdOrCtrl+-',
        click: () => event.sender.send('shortcut:font-decrease')
      },
      {
        label: '重置',
        accelerator: 'CmdOrCtrl+0',
        click: () => event.sender.send('shortcut:font-reset')
      }
    ]
  })

  menuTemplate.push({ type: 'separator' })

  if (isMarkdownPreview) {
    // v1.3 原有功能：复制功能
    menuTemplate.push({
      label: '📋 复制为 Markdown',
      click: () => event.sender.send('markdown:copy-source')
    })

    menuTemplate.push({
      label: '📝 复制为纯文本',
      click: () => event.sender.send('markdown:copy-plain-text')
    })

    menuTemplate.push({
      label: '🌐 复制为 HTML',
      click: () => event.sender.send('markdown:copy-html')
    })
  }

  // 如果有选中内容，添加复制选中内容选项
  if (hasSelection) {
    menuTemplate.push({ type: 'separator' })
    menuTemplate.push({
      label: '✂️ 复制选中内容',
      accelerator: 'CmdOrCtrl+C',
      click: () => event.sender.copy()
    })
  }

  // v1.3.7: 如果有标题，添加"复制链接"
  if (isMarkdownPreview && headingId) {
    menuTemplate.push({ type: 'separator' })
    menuTemplate.push({
      label: '🔗 复制链接',
      click: () => {
        clipboard.writeText(`${filePath}#${headingId}`)
      }
    })
  }

  // v1.4.0: 查看所有快捷键（打开帮助弹窗）
  // 文件路径操作菜单项
  menuTemplate.push({ type: 'separator' })

  const showInFolderLabel =
    process.platform === 'darwin'
      ? '📂 在 Finder 中显示'
      : process.platform === 'win32'
      ? '📂 在资源管理器中显示'
      : '📂 在文件管理器中显示'

  menuTemplate.push({
    label: showInFolderLabel,
    click: () => {
      shell.showItemInFolder(filePath)
    }
  })

  menuTemplate.push({
    label: '📋 复制路径',
    accelerator: 'CmdOrCtrl+Alt+C',
    click: () => {
      clipboard.writeText(filePath)
    }
  })

  menuTemplate.push({
    label: '📎 复制相对路径',
    accelerator: 'Shift+Alt+C',
    enabled: !!basePath,
    click: () => {
      if (basePath) {
        clipboard.writeText(path.relative(basePath, filePath))
      }
    }
  })

  menuTemplate.push({ type: 'separator' })
  menuTemplate.push({
    label: '⌨️ 查看所有快捷键',
    click: () => {
      event.sender.send('open-shortcuts-help')
    }
  })

  const menu = Menu.buildFromTemplate(menuTemplate)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    menu.popup({ window })
  }
})
}
