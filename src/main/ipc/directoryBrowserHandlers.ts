import { ipcMain } from 'electron'
import { lstat, readdir, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import { isWorkspaceRelativePath, type WorkspaceDirectoryEntry } from '../../shared/directoryBrowser'
import type { IPCContext } from './context'
import { getSenderWorkspaceForOperation, validateWorkspaceOperationPath } from './senderSecurity'
import { validateNotProtected } from '../security'

export function registerDirectoryBrowserHandlers(ctx: IPCContext): void {
  ipcMain.handle('browser:listDirectory', async (event, operation: WorkspaceOperationContext, relativePath: unknown) => {
    if (!isWorkspaceRelativePath(relativePath)) {
      throw new Error('无效的工作区相对目录')
    }
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    const root = await realpath(workspace.primaryRoot)
    const target = path.join(root, relativePath)
    const canonical = await validateWorkspaceOperationPath(ctx, event, operation, target)
    // Directory policy patterns protect descendants as well as the directory entry.
    validateNotProtected(path.join(canonical, '_'))
    let current = root
    for (const part of relativePath ? relativePath.split('/') : []) {
      current = path.join(current, part)
      if ((await lstat(current)).isSymbolicLink()) throw new Error('不展开符号链接目录')
    }
    const before = await lstat(canonical)
    if (!before.isDirectory()) throw new Error('目标不是目录')
    const entries = await readdir(canonical, { withFileTypes: true })
    const afterPath = await validateWorkspaceOperationPath(ctx, event, operation, target)
    const after = await lstat(afterPath)
    if (afterPath !== canonical || after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error('目录已变化，请刷新重试')
    }
    return entries.map((entry): WorkspaceDirectoryEntry => ({
      name: entry.name,
      relativePath: relativePath ? `${relativePath}/${entry.name}` : entry.name,
      kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    })).sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
  })
}
