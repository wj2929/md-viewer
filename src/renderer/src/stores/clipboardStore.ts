/**
 * 应用内剪贴板 Store
 * @module clipboardStore
 * @description v1.3 阶段 3 重构 - 单一数据源架构 + 事务性粘贴
 */

import { create } from 'zustand'

/**
 * 粘贴结果接口
 */
export interface PasteResult {
  success: string[]
  failed: { path: string; error: string }[]
}

/**
 * 剪贴板状态接口
 */
interface ClipboardState {
  /** 剪贴板中的文件路径集合 */
  files: Set<string>
  /** 是否为剪切操作（false = 复制） */
  isCut: boolean
  /** 复制文件到剪贴板 */
  copy: (paths: string[]) => void
  /** 剪切文件到剪贴板 */
  cut: (paths: string[]) => void
  /** 粘贴文件到目标目录（事务性） */
  paste: (targetDir: string) => Promise<PasteResult>
  /** 清空剪贴板 */
  clear: () => void
  /** 检查剪贴板是否有文件 */
  hasFiles: () => boolean
  /** 检查指定路径是否在剪贴板中 */
  isInClipboard: (filePath: string) => boolean
  /** 获取剪贴板状态（用于主进程同步） */
  getState: () => { files: string[]; isCut: boolean; hasFiles: boolean }
}

/**
 * 创建剪贴板 Store
 * v1.3 重构：渲染进程作为唯一数据源
 */
export const useClipboardStore = create<ClipboardState>((set, get) => ({
  files: new Set(),
  isCut: false,

  /**
   * 复制文件到剪贴板
   * @param paths - 文件路径数组
   */
  copy: (paths: string[]) => {
    console.log('[Clipboard] Copy:', paths)
    set({ files: new Set(paths), isCut: false })
    // v1.3：同步状态到主进程（用于右键菜单查询）
    window.api.syncClipboardState?.(paths, false)
  },

  /**
   * 剪切文件到剪贴板
   * @param paths - 文件路径数组
   */
  cut: (paths: string[]) => {
    console.log('[Clipboard] Cut:', paths)
    set({ files: new Set(paths), isCut: true })
    // v1.3：同步状态到主进程
    window.api.syncClipboardState?.(paths, true)
  },

  /**
   * 粘贴文件到目标目录（事务性 - 前端专家要求）
   * 只有全部成功才清空剪贴板，失败时不丢失数据
   * @param targetDir - 目标目录路径
   * @returns 粘贴结果
   */
  paste: async (targetDir: string): Promise<PasteResult> => {
    const { files, isCut } = get()
    const result: PasteResult = { success: [], failed: [] }

    if (files.size === 0) {
      console.warn('[Clipboard] Paste failed: clipboard is empty')
      throw new Error('剪贴板为空')
    }

    console.log(`[Clipboard] Paste to ${targetDir}, isCut: ${isCut}`)

    for (const srcPath of files) {
      try {
        // 使用简单的路径处理（避免引入 path-browserify）
        const fileName = srcPath.split(/[/\\]/).pop() || 'unknown'
        const sep = targetDir.includes('\\') ? '\\' : '/'
        const destPath = targetDir + sep + fileName

        // 检查源文件和目标路径是否相同
        if (srcPath === destPath) {
          console.log(`[Clipboard] Skip self-paste: ${srcPath}`)
          continue
        }

        // 检查是否粘贴到自己的子目录
        if (destPath.startsWith(srcPath + '/') || destPath.startsWith(srcPath + '\\')) {
          console.error(`[Clipboard] Cannot paste into subdirectory: ${srcPath} -> ${destPath}`)
          result.failed.push({ path: srcPath, error: '无法粘贴到子目录' })
          continue
        }

        // 检查目标文件是否已存在
        const exists = await window.api.fileExists(destPath)
        if (exists) {
          console.error(`[Clipboard] Target file already exists: ${destPath}`)
          result.failed.push({ path: srcPath, error: '目标文件已存在' })
          continue
        }

        // 检查是否为目录
        const isDirectory = await window.api.isDirectory(srcPath)

        if (isCut) {
          // 剪切操作：移动文件
          await window.api.moveFile(srcPath, destPath)
          console.log(`[Clipboard] Moved: ${srcPath} -> ${destPath}`)
        } else {
          // 复制操作：复制文件或目录
          if (isDirectory) {
            await window.api.copyDir(srcPath, destPath)
            console.log(`[Clipboard] Copied directory: ${srcPath} -> ${destPath}`)
          } else {
            await window.api.copyFile(srcPath, destPath)
            console.log(`[Clipboard] Copied file: ${srcPath} -> ${destPath}`)
          }
        }

        result.success.push(srcPath)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误'
        console.error(`[Clipboard] Failed to ${isCut ? 'move' : 'copy'} ${srcPath}:`, error)
        result.failed.push({ path: srcPath, error: errorMsg })
      }
    }

    // v1.3 事务性：只有剪切且全部成功才清空剪贴板
    if (isCut && result.failed.length === 0 && result.success.length > 0) {
      set({ files: new Set(), isCut: false })
      console.log('[Clipboard] Cleared after successful cut')
      // 同步空状态到主进程
      window.api.syncClipboardState?.([], false)
    } else if (isCut && result.success.length > 0) {
      // 部分成功：只移除成功的文件
      const remainingFiles = new Set(files)
      result.success.forEach(path => remainingFiles.delete(path))
      set({ files: remainingFiles })
      console.log('[Clipboard] Partial success, remaining:', Array.from(remainingFiles))
      window.api.syncClipboardState?.(Array.from(remainingFiles), true)
    }

    return result
  },

  /**
   * 清空剪贴板
   */
  clear: () => {
    console.log('[Clipboard] Cleared')
    set({ files: new Set(), isCut: false })
    // 同步到主进程
    window.api.syncClipboardState?.([], false)
  },

  /**
   * 检查剪贴板是否有文件
   * @returns 是否有文件
   */
  hasFiles: () => {
    return get().files.size > 0
  },

  /**
   * 检查指定路径是否在剪贴板中
   * @param filePath - 文件路径
   * @returns 是否在剪贴板中
   */
  isInClipboard: (filePath: string) => {
    return get().files.has(filePath)
  },

  /**
   * 获取剪贴板状态（用于主进程同步）
   * @returns 剪贴板状态快照
   */
  getState: () => {
    const state = get()
    return {
      files: Array.from(state.files),
      isCut: state.isCut,
      hasFiles: state.files.size > 0
    }
  }
}))
