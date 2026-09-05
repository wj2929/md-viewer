import { BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, clipboard, shell } from 'electron'
import * as path from 'path'
import { IPCContext } from './context'
import { validateSecurePathInBase } from '../security'
import { getSenderWorkspaceForOperation, validateSenderReadPath, resolveRecentFolderRoot } from './senderSecurity'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import { showContextMenu, dispatchFileClipboardAction } from '../contextMenuHandler'
import { showTabContextMenu, TabMenuContext } from '../tabMenuHandler'
import { showMarkdownContextMenu, MarkdownMenuContext } from '../markdownMenuHandler'
import { appDataManager } from '../appDataManager'
import { getLastDocxExportPath } from './exportHandlers'
import { openMarkdownInNewWindow } from '../openMarkdownInNewWindow'
import { openFolderInNewWindow } from '../folderActivation'
import * as fs from 'fs'
import { getFileManagerLabels } from '../platformMenuLabels'

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
ipcMain.handle('context-menu:show', async (
  event,
  file: FileInfo,
  _basePath: string,
  operation: WorkspaceOperationContext
) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  const basePath = workspace.primaryRoot
  if (!basePath) {
    throw new Error('当前工作区未绑定文件夹')
  }
  await validateSecurePathInBase(file.path, basePath)
  await validateSecurePathInBase(basePath, basePath)

  showContextMenu(window, file, basePath, {
    openMarkdownInNewWindow: filePath => openMarkdownInNewWindow(ctx, filePath, basePath).then(() => undefined),
    removeDocumentMarks: async (filePath, isDirectory) => {
      if (ctx.appDataManager.removeDocumentMarks(basePath, filePath, isDirectory)) {
        window.webContents.send('document-marks:changed')
        ctx.windowManager.broadcastToOthers(window.id, 'document-marks:changed')
      }
    }
  })
  return { success: true }
})

if (process.env.NODE_ENV === 'test') {
  ipcMain.handle(
    'test:file-clipboard-action',
    (event, action: 'copy' | 'cut' | 'paste', target: string | string[]) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        throw new Error('无法获取窗口实例')
      }
      dispatchFileClipboardAction(window, action, target)
      return { success: true }
    }
  )
}

// v1.3 新增：显示 Tab 右键菜单
ipcMain.handle('tab:show-context-menu', async (event, menuCtx: TabMenuContext) => {
  // ⚠️ 安全校验：按发起窗口根目录校验
  await validateSenderReadPath(ctx, event, menuCtx.filePath)
  await validateSenderReadPath(ctx, event, menuCtx.basePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showTabContextMenu(window, menuCtx)
  return { success: true }
})

// v1.3 阶段 2：显示 Markdown 右键菜单
ipcMain.handle('markdown:show-context-menu', async (event, menuCtx: MarkdownMenuContext) => {
  // ⚠️ 安全校验：按发起窗口根目录校验
  await validateSenderReadPath(ctx, event, menuCtx.filePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showMarkdownContextMenu(window, menuCtx)
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

  const menu = Menu.buildFromTemplate([
    {
      label: '📐 在分屏中打开',
      submenu: [
        {
          label: '向右分屏',
          click: () => {
            window.webContents.send('file:open-in-split', {
              filePath: bookmark.filePath,
              direction: 'horizontal'
            })
          }
        },
        {
          label: '向下分屏',
          click: () => {
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
ipcMain.handle('context-menu:recent-file', async (event, recentId: string) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return { success: false, error: '无法获取窗口实例' }
  if (typeof recentId !== 'string' || !recentId) {
    return { success: false, error: '最近文件标识无效' }
  }

  const recentFile = ctx.appDataManager.getRecentFile(recentId)
  if (!recentFile) return { success: false, error: '最近文件不存在' }

  let canonicalFilePath: string | null = null
  let openRoot: string | null = null
  let relativePath: string | null = null
  try {
    const candidate = await validateSenderReadPath(ctx, event, recentFile.path)
    const fileStat = await fs.promises.stat(candidate)
    if (!fileStat.isFile()) throw new Error('目标不是文件')
    canonicalFilePath = candidate
    openRoot = await resolveRecentFolderRoot(ctx, event, candidate)
  } catch {
    // 失效记录仍允许从历史中移除
  }

  if (canonicalFilePath) {
    try {
      const canonicalRoot = await fs.promises.realpath(recentFile.folderPath)
      const rootStat = await fs.promises.stat(canonicalRoot)
      if (!rootStat.isDirectory()) throw new Error('记录的工作区根不是文件夹')
      await validateSecurePathInBase(canonicalFilePath, canonicalRoot)
      const candidate = path.relative(canonicalRoot, canonicalFilePath).split(path.sep).join('/')
      if (candidate && !path.isAbsolute(candidate) && candidate !== '..' && !candidate.startsWith('../')) {
        relativePath = candidate
      }
    } catch {
      // 旧根失效时仅禁用相对路径
    }
  }

  const fileManagerLabels = getFileManagerLabels()
  const reportError = (action: string, error: unknown) => {
    console.error(`[context-menu:recent-file] ${action}:`, error)
    window.webContents.send('error:show', {
      message: `${action}：${error instanceof Error ? error.message : '未知错误'}`,
    })
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: `📂 ${fileManagerLabels.showInFolder}`,
      enabled: Boolean(canonicalFilePath),
      click: () => {
        try {
          shell.showItemInFolder(canonicalFilePath!)
        } catch (error) {
          reportError(`无法在 ${fileManagerLabels.fileManagerName} 中显示`, error)
        }
      },
    },
    {
      label: '📋 复制路径',
      enabled: Boolean(canonicalFilePath),
      click: () => {
        try {
          clipboard.writeText(canonicalFilePath!)
        } catch (error) {
          reportError('复制路径失败', error)
        }
      },
    },
    {
      label: '📎 复制相对路径',
      enabled: Boolean(relativePath),
      click: () => {
        try {
          clipboard.writeText(relativePath!)
        } catch (error) {
          reportError('复制相对路径失败', error)
        }
      },
    },
    { type: 'separator' },
    {
      label: '📐 在分屏中打开',
      enabled: Boolean(canonicalFilePath),
      submenu: [
        {
          label: '向右分屏',
          click: () => window.webContents.send('file:open-in-split', {
            filePath: canonicalFilePath,
            direction: 'horizontal',
          }),
        },
        {
          label: '向下分屏',
          click: () => window.webContents.send('file:open-in-split', {
            filePath: canonicalFilePath,
            direction: 'vertical',
          }),
        },
      ],
    },
    {
      label: '🗔 在新窗口中打开',
      enabled: Boolean(canonicalFilePath && openRoot),
      click: () => {
        void openMarkdownInNewWindow(ctx, canonicalFilePath!, openRoot!).catch(error => {
          reportError('在新窗口中打开失败', error)
        })
      },
    },
    { type: 'separator' },
    {
      label: '🗑️ 从历史中移除',
      click: () => window.webContents.send('recent-file:remove', recentFile.path),
    },
  ]

  Menu.buildFromTemplate(template).popup({ window })
  return { success: true }
})

// 最近文件夹右键菜单
ipcMain.handle('context-menu:recent-folder', async (event, historyId: string) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return { success: false, error: '无法获取窗口实例' }
  if (typeof historyId !== 'string' || !historyId) {
    return { success: false, error: '最近文件夹标识无效' }
  }

  const historyItem = (await ctx.folderHistoryManager.getHistory()).find(item => item.id === historyId)
  if (!historyItem) return { success: false, error: '最近文件夹不存在' }
  let resolvedPath = await ctx.folderHistoryManager.resolveHistoryFolder(historyId)
  if (resolvedPath) {
    try {
      resolvedPath = await validateSecurePathInBase(resolvedPath, resolvedPath)
    } catch {
      resolvedPath = null
    }
  }
  const fileManagerLabels = getFileManagerLabels()
  const reportError = (action: string, error: unknown) => {
    console.error(`[context-menu:recent-folder] ${action}:`, error)
    window.webContents.send('error:show', {
      message: `${action}：${error instanceof Error ? error.message : '未知错误'}`,
    })
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: `📂 ${fileManagerLabels.showInFolder}`,
      enabled: Boolean(resolvedPath),
      click: () => {
        try {
          shell.showItemInFolder(resolvedPath!)
        } catch (error) {
          reportError(`无法在 ${fileManagerLabels.fileManagerName} 中显示`, error)
        }
      },
    },
    {
      label: '📋 复制路径',
      enabled: Boolean(resolvedPath),
      click: () => {
        try {
          clipboard.writeText(resolvedPath!)
        } catch (error) {
          reportError('复制路径失败', error)
        }
      },
    },
    { type: 'separator' },
    {
      label: '🗔 在新窗口中打开',
      enabled: Boolean(resolvedPath),
      click: () => {
        if (!resolvedPath) return
        try {
          openFolderInNewWindow(ctx, resolvedPath)
        } catch (error) {
          reportError('在新窗口中打开失败', error)
        }
      },
    },
  ]

  Menu.buildFromTemplate(template).popup({ window })
  return { success: true }
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
  chartCount?: number
  linkHref: string | null
  basePath: string | null
}) => {
  // ⚠️ 安全校验：按发起窗口根目录校验
  await validateSenderReadPath(ctx, event, params.filePath)

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
    chartCount = 0,
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

    // v2.7.0: 从当前行朗读(传源码行号,渲染层映射到朗读句起点)
    menuTemplate.push({
      label: '🔊 从当前行播放',
      click: () =>
        event.sender.send('markdown:read-aloud-from-line', {
          sourceLine: typeof sourceLine === 'number' ? sourceLine : null,
        })
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

  if (isMarkdownPreview && chartCount > 0) {
    menuTemplate.push({
      label: `📦 打包下载图表（${chartCount} 张）`,
      click: () => event.sender.send('markdown:export-charts-zip', {
        filePath,
        ...(tabId ? { tabId } : {}),
        ...(leafId ? { leafId } : {}),
      })
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
