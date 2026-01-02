import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs/promises'
import * as path from 'path'
import Store from 'electron-store'

// 定义存储的数据结构
interface AppState {
  lastOpenedFolder: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
}

// 初始化 electron-store
const store = new Store<AppState>({
  defaults: {
    lastOpenedFolder: null,
    windowBounds: {
      width: 1200,
      height: 800
    }
  }
})

function createWindow(): void {
  // 从 store 恢复窗口大小和位置
  const savedBounds = store.get('windowBounds')

  const mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()

    // 恢复上次打开的文件夹
    const lastFolder = store.get('lastOpenedFolder')
    if (lastFolder) {
      mainWindow.webContents.send('restore-folder', lastFolder)
    }
  })

  // 窗口关闭前保存状态
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds()
    store.set('windowBounds', bounds)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境加载 dev server，生产环境加载打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 设置 app user model id (Windows)
  electronApp.setAppUserModelId('com.mdviewer')

  // 开发环境下优化
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ============== IPC Handlers ==============

// 打开文件夹对话框
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  // 保存最后打开的文件夹
  const folderPath = result.filePaths[0]
  store.set('lastOpenedFolder', folderPath)

  return folderPath
})

// 文件信息接口
interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  children?: FileInfo[]
}

// 递归读取目录（只读取 .md 文件）
async function readDirRecursive(dirPath: string): Promise<FileInfo[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const results: FileInfo[] = []

  for (const entry of entries) {
    // 跳过隐藏文件和 node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      const children = await readDirRecursive(fullPath)
      // 只添加包含 .md 文件的目录
      if (children.length > 0) {
        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true,
          children
        })
      }
    } else if (entry.name.endsWith('.md')) {
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: false
      })
    }
  }

  // 目录优先，然后按名称排序
  return results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
}

// 读取目录
ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
  try {
    return await readDirRecursive(dirPath)
  } catch (error) {
    console.error('Failed to read directory:', error)
    return []
  }
})

// 读取文件内容
ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  try {
    const stats = await fs.stat(filePath)
    const MAX_SIZE = 5 * 1024 * 1024 // 5MB 限制

    if (stats.size > MAX_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
    }

    return await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    console.error('Failed to read file:', error)
    return ''
  }
})

// 导出 HTML
ipcMain.handle('export:html', async (_, htmlContent: string, fileName: string) => {
  try {
    const result = await dialog.showSaveDialog({
      title: '导出 HTML',
      defaultPath: fileName.replace(/\.md$/, '.html'),
      filters: [
        { name: 'HTML Files', extensions: ['html'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 读取 CSS 文件 - 使用正确的路径
    let markdownCss = ''
    let prismCss = ''

    try {
      // 开发环境路径
      if (is.dev) {
        const srcPath = join(__dirname, '../../src/renderer/src/assets')
        markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
      } else {
        // 生产环境路径
        const assetsPath = join(__dirname, '../renderer/assets')
        markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
      }
    } catch (cssError) {
      console.error('Failed to read CSS files:', cssError)
      // 如果CSS文件读取失败，使用内联的基础样式
      markdownCss = `
        .markdown-body { font-size: 16px; line-height: 1.6; }
        .markdown-body h1 { font-size: 2em; margin: 0.67em 0; }
        .markdown-body h2 { font-size: 1.5em; margin: 0.75em 0; }
        .markdown-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; }
        .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
      `
      prismCss = ''
    }

    // KaTeX CSS (使用 CDN)
    const katexCss = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'

    // 生成完整 HTML
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  ${katexCss}
  <style>
    :root {
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --border-color: #d0d7de;
      --accent-color: #0969da;
    }

    body {
      margin: 0;
      padding: 20px;
      background: var(--bg-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-radius: 6px;
    }

    ${markdownCss}
    ${prismCss}
  </style>
</head>
<body>
  <div class="container">
    <div class="markdown-body">
      ${htmlContent}
    </div>
  </div>
</body>
</html>`

    await fs.writeFile(result.filePath, fullHtml, 'utf-8')
    return result.filePath
  } catch (error) {
    console.error('Failed to export HTML:', error)
    throw error
  }
})

// 导出 PDF
ipcMain.handle('export:pdf', async (event, htmlContent: string, fileName: string) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出 PDF',
      defaultPath: fileName.replace(/\.md$/, '.pdf'),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 创建一个隐藏的窗口用于打印
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 读取 CSS 文件
    let markdownCss = ''
    let prismCss = ''

    try {
      if (is.dev) {
        const srcPath = join(__dirname, '../../src/renderer/src/assets')
        markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
      } else {
        const assetsPath = join(__dirname, '../renderer/assets')
        markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
      }
    } catch (cssError) {
      console.error('Failed to read CSS files:', cssError)
      markdownCss = `
        .markdown-body { font-size: 16px; line-height: 1.6; }
        .markdown-body h1 { font-size: 2em; margin: 0.67em 0; }
        .markdown-body h2 { font-size: 1.5em; margin: 0.75em 0; }
        .markdown-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; }
        .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
      `
      prismCss = ''
    }

    // 生成 PDF 专用的 HTML
    const pdfHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      margin: 20mm;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: white;
    }

    :root {
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --border-color: #d0d7de;
      --accent-color: #0969da;
    }

    ${markdownCss}
    ${prismCss}

    /* PDF 专用样式 */
    @media print {
      body { margin: 0; }
      .markdown-body { max-width: none; }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    ${htmlContent}
  </div>
</body>
</html>`

    // 加载 HTML 内容
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfHtml)}`)

    // 等待页面加载完成
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 打印为 PDF
    const pdfData = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      marginsType: 0,  // 使用默认边距
      printBackground: true
    })

    // 关闭打印窗口
    printWindow.close()

    await fs.writeFile(result.filePath, pdfData)
    return result.filePath
  } catch (error) {
    console.error('Failed to export PDF:', error)
    throw error
  }
})
