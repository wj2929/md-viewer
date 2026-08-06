/**
 * 主进程剪贴板状态管理
 * @module clipboardState
 * @description v1.3 阶段 3 - 渲染进程是唯一数据源，这里只是状态镜像
 */

import * as path from 'path'

interface ClipboardState {
  files: string[]
  isCut: boolean
}

const clipboardStates = new Map<number, ClipboardState>()

/**
 * 同步窗口的剪贴板状态
 * @param webContentsId - 发送剪贴板操作的窗口
 * @param files - 已校验的文件路径数组
 * @param isCut - 是否为剪切
 */
export function syncClipboardState(webContentsId: number, files: string[], isCut: boolean): void {
  clipboardStates.set(webContentsId, {
    files: files.map(filePath => path.resolve(filePath)),
    isCut
  })
  console.log('[CLIPBOARD] State synced:', { webContentsId, count: files.length, isCut })
}

/**
 * 获取窗口的剪贴板状态快照
 */
export function getClipboardState(webContentsId: number): { files: string[]; isCut: boolean; hasFiles: boolean } {
  const state = clipboardStates.get(webContentsId) ?? { files: [], isCut: false }
  return {
    files: [...state.files],
    isCut: state.isCut,
    hasFiles: state.files.length > 0
  }
}

/**
 * 检查路径是否为该窗口已复制的精确来源
 */
export function isClipboardSourceAuthorized(webContentsId: number, sourcePath: string): boolean {
  return clipboardStates.get(webContentsId)?.files.includes(path.resolve(sourcePath)) ?? false
}

/**
 * 清空窗口的剪贴板状态
 */
export function clearClipboardState(webContentsId: number): void {
  clipboardStates.delete(webContentsId)
  console.log('[CLIPBOARD] State cleared:', { webContentsId })
}
