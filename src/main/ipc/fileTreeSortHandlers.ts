import { ipcMain } from 'electron'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import type { IPCContext } from './context'
import { getSenderWorkspaceForOperation, validateWorkspaceOperationPath } from './senderSecurity'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import { FILE_TREE_METADATA_BATCH_SIZE, type FileTreeMetadataResult } from '../../shared/fileTreeSort'

const previewExtension = /\.(md|markdown|mdown|mkd|mkdn|excalidraw)$/i

export function registerFileTreeSortHandlers(ctx: IPCContext): void {
  const busy = new Set<number>()
  ipcMain.handle('fs:fileTreeMetadata', async (event, relativePaths: unknown, operation: WorkspaceOperationContext): Promise<FileTreeMetadataResult[]> => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    const root = workspace.primaryRoot
    if (!root) throw new Error('当前工作区未绑定文件夹')
    if (!Array.isArray(relativePaths) || relativePaths.length > FILE_TREE_METADATA_BATCH_SIZE || relativePaths.some(value =>
      typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || value.includes('\\')
      || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')
      || !previewExtension.test(value)
    )) throw new Error('无效的文件树属性请求')
    if (busy.has(event.sender.id)) throw new Error('文件树属性读取仍在进行')
    busy.add(event.sender.id)
    try {
      const paths = [...new Set(relativePaths as string[])]
      const result: FileTreeMetadataResult[] = new Array(paths.length)
      let next = 0
      const current = (): void => {
        if (getSenderWorkspaceForOperation(ctx, event, operation).primaryRoot !== root) throw new Error('工作区已失效')
      }
      const workers = await Promise.allSettled(Array.from({ length: Math.min(8, paths.length) }, async () => {
        while (next < paths.length) {
          const index = next++
          const relativePath = paths[index]
          current()
          let value: FileTreeMetadataResult['value'] = null
          try {
            const target = path.join(root, relativePath)
            const canonical = await validateWorkspaceOperationPath(ctx, event, operation, target)
            const info = await stat(canonical)
            const confirmed = await validateWorkspaceOperationPath(ctx, event, operation, target)
            if (canonical === confirmed && info.isFile() && Number.isFinite(info.mtimeMs)
              && Number.isFinite(info.size) && info.size >= 0) value = { mtimeMs: info.mtimeMs, size: info.size }
          } catch {
            // 单个文件消失、受保护或无法读取时不泄露系统路径，也不删除树节点。
          }
          current()
          result[index] = { relativePath, value }
        }
      }))
      const failure = workers.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      current()
      return result
    } finally {
      busy.delete(event.sender.id)
    }
  })
}
