/**
 * 主进程剪贴板状态管理
 * @module clipboardState
 * @description v1.3 阶段 3 - 渲染进程是唯一数据源，这里只是状态镜像
 */

/**
 * 剪贴板状态缓存
 */
let clipboardStateCache: {
  files: string[]
  isCut: boolean
} = {
  files: [],
  isCut: false
}

/**
 * 同步剪贴板状态
 * @param files - 文件路径列表
 * @param isCut - 是否为剪切
 */
export function syncClipboardState(files: string[], isCut: boolean): void {
  clipboardStateCache = { files, isCut }
  console.log('[CLIPBOARD] State synced:', { count: files.length, isCut })
}

/**
 * 获取剪贴板状态
 * @returns 剪贴板状态快照
 */
export function getClipboardState(): { files: string[]; isCut: boolean; hasFiles: boolean } {
  return {
    files: clipboardStateCache.files,
    isCut: clipboardStateCache.isCut,
    hasFiles: clipboardStateCache.files.length > 0
  }
}

/**
 * 清空剪贴板状态
 */
export function clearClipboardState(): void {
  clipboardStateCache = { files: [], isCut: false }
  console.log('[CLIPBOARD] State cleared')
}
