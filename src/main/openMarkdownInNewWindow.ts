import * as fs from 'fs/promises'
import * as path from 'path'
import type { IPCContext } from './ipc/context'
import { activateFolderForWindow } from './folderActivation'
import { validateSecurePathInBase } from './security'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])

export async function openMarkdownInNewWindow(
  ctx: IPCContext,
  filePath: string,
  sourceBasePath: string
): Promise<number> {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error('只能在新窗口中打开 Markdown 文件')
  }

  const resolvedFilePath = await validateSecurePathInBase(filePath, sourceBasePath)
  const stats = await fs.stat(resolvedFilePath)
  if (!stats.isFile()) {
    throw new Error('目标不是 Markdown 文件')
  }

  const targetWindow = ctx.windowManager.createWindow()
  ctx.windowManager.addPendingAction(targetWindow.id, () => {
    return (async () => {
      try {
        if (targetWindow.isDestroyed()) return
        await activateFolderForWindow(ctx, targetWindow, path.dirname(resolvedFilePath), {
          notifyRenderer: true
        })
        if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) return
        targetWindow.webContents.send('open-specific-file', resolvedFilePath)
      } catch (error) {
        console.error('[openMarkdownInNewWindow] Failed to open file:', error)
        if (!targetWindow.isDestroyed()) targetWindow.close()
      }
    })()
  })

  return targetWindow.id
}
