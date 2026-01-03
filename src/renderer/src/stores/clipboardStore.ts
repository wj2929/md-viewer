/**
 * 应用内剪贴板 Store
 * @module clipboardStore
 * @description 使用 Zustand 管理文件复制/剪切/粘贴状态
 */

import { create } from 'zustand'
import * as path from 'path-browserify'

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
  /** 粘贴文件到目标目录 */
  paste: (targetDir: string) => Promise<void>
  /** 清空剪贴板 */
  clear: () => void
  /** 检查剪贴板是否有文件 */
  hasFiles: () => boolean
  /** 检查指定路径是否在剪贴板中 */
  isInClipboard: (filePath: string) => boolean
}

/**
 * 创建剪贴板 Store
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
  },

  /**
   * 剪切文件到剪贴板
   * @param paths - 文件路径数组
   */
  cut: (paths: string[]) => {
    console.log('[Clipboard] Cut:', paths)
    set({ files: new Set(paths), isCut: true })
  },

  /**
   * 粘贴文件到目标目录
   * @param targetDir - 目标目录路径
   */
  paste: async (targetDir: string) => {
    const { files, isCut } = get()

    if (files.size === 0) {
      console.warn('[Clipboard] Paste failed: clipboard is empty')
      return
    }

    console.log(`[Clipboard] Paste to ${targetDir}, isCut: ${isCut}`)

    const errors: string[] = []

    for (const srcPath of files) {
      try {
        const fileName = path.basename(srcPath)
        const destPath = path.join(targetDir, fileName)

        // 检查源文件和目标路径是否相同
        if (srcPath === destPath) {
          console.log(`[Clipboard] Skip self-paste: ${srcPath}`)
          continue
        }

        // 检查是否粘贴到自己的子目录
        if (destPath.startsWith(srcPath + path.sep)) {
          console.error(`[Clipboard] Cannot paste into subdirectory: ${srcPath} -> ${destPath}`)
          errors.push(`无法将 ${fileName} 粘贴到其子目录中`)
          continue
        }

        // 检查目标文件是否已存在
        const exists = await window.api.fileExists(destPath)
        if (exists) {
          console.error(`[Clipboard] Target file already exists: ${destPath}`)
          errors.push(`文件 ${fileName} 已存在`)
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
      } catch (error) {
        const fileName = path.basename(srcPath)
        const errorMsg = error instanceof Error ? error.message : '未知错误'
        console.error(`[Clipboard] Failed to ${isCut ? 'move' : 'copy'} ${srcPath}:`, error)
        errors.push(`${fileName}: ${errorMsg}`)
      }
    }

    // 剪切后清空剪贴板，复制后保留
    if (isCut) {
      set({ files: new Set(), isCut: false })
      console.log('[Clipboard] Cleared after cut')
    }

    // 如果有错误，抛出异常
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  },

  /**
   * 清空剪贴板
   */
  clear: () => {
    console.log('[Clipboard] Cleared')
    set({ files: new Set(), isCut: false })
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
  }
}))
