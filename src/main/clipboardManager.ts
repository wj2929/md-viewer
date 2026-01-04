/**
 * 跨应用剪贴板管理器
 * @module clipboardManager
 * @description v1.3 阶段 6 - 系统剪贴板双向同步 + 主进程安全过滤
 */

import { clipboard } from 'electron'
import * as os from 'os'
import * as fs from 'fs'
import { isProtectedPath } from './security'

/**
 * 剪贴板文件信息
 */
export interface ClipboardFile {
  path: string
  exists: boolean
  isAllowed: boolean
  reason?: string
}

/**
 * 从系统剪贴板读取文件路径
 * ⚠️ 安全关键：必须过滤后再返回
 * @returns 过滤后的安全文件路径列表
 */
export function readFilesFromSystemClipboard(): ClipboardFile[] {
  const platform = os.platform()
  let rawPaths: string[] = []

  try {
    if (platform === 'darwin') {
      // macOS: 尝试读取 NSFilenamesPboardType
      const buffer = clipboard.readBuffer('NSFilenamesPboardType')
      if (buffer && buffer.length > 0) {
        // NSFilenamesPboardType 是 plist 格式，简化解析
        const plistStr = buffer.toString('utf8')
        const matches = plistStr.match(/<string>([^<]+)<\/string>/g)
        if (matches) {
          rawPaths = matches.map(m => m.replace(/<\/?string>/g, ''))
        }
      }

      // 备选：读取 public.file-url 格式
      if (rawPaths.length === 0) {
        const text = clipboard.readText()
        if (text.startsWith('file://')) {
          rawPaths = text.split('\n')
            .filter(line => line.startsWith('file://'))
            .map(line => decodeURIComponent(line.replace('file://', '')))
        }
      }
    } else if (platform === 'win32') {
      // Windows: 尝试读取 FileNameW
      const buffer = clipboard.readBuffer('FileNameW')
      if (buffer && buffer.length > 0) {
        // UTF-16LE 编码，以双 null 结尾
        const text = buffer.toString('utf16le')
        rawPaths = text.split('\0').filter(p => p.length > 0)
      }
    } else {
      // Linux: 读取 text/uri-list
      const text = clipboard.readText()
      if (text.includes('file://')) {
        rawPaths = text.split('\n')
          .filter(line => line.startsWith('file://'))
          .map(line => decodeURIComponent(line.replace('file://', '')))
      }
    }
  } catch (error) {
    console.error('[ClipboardManager] Failed to read system clipboard:', error)
    return []
  }

  // 安全过滤
  return rawPaths.map(path => {
    const exists = fs.existsSync(path)
    const isProtected = isProtectedPath(path)

    return {
      path,
      exists,
      isAllowed: exists && !isProtected,
      reason: !exists ? '文件不存在' : isProtected ? '受保护的系统路径' : undefined
    }
  })
}

/**
 * 将文件路径写入系统剪贴板
 * @param paths - 文件路径列表
 * @param isCut - 是否为剪切操作
 */
export function writeFilesToSystemClipboard(paths: string[], isCut: boolean = false): boolean {
  const platform = os.platform()

  try {
    // 过滤无效路径
    const validPaths = paths.filter(p => fs.existsSync(p))
    if (validPaths.length === 0) {
      console.warn('[ClipboardManager] No valid paths to write')
      return false
    }

    if (platform === 'darwin') {
      // macOS: 写入 NSFilenamesPboardType 格式
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${validPaths.map(p => `  <string>${p}</string>`).join('\n')}
</array>
</plist>`
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistContent, 'utf8'))

      // 同时写入 file:// URL 格式作为备选
      const fileUrls = validPaths.map(p => 'file://' + encodeURIComponent(p).replace(/%2F/g, '/')).join('\n')
      clipboard.writeText(fileUrls)

      console.log('[ClipboardManager] Wrote', validPaths.length, 'files to macOS clipboard')
      return true
    } else if (platform === 'win32') {
      // Windows: 简化实现，只写入文本格式
      clipboard.writeText(validPaths.join('\n'))
      console.log('[ClipboardManager] Wrote', validPaths.length, 'files to Windows clipboard (text format)')
      return true
    } else {
      // Linux: 写入 file:// URI 格式
      const fileUrls = validPaths.map(p => 'file://' + encodeURIComponent(p).replace(/%2F/g, '/')).join('\n')
      clipboard.writeText(fileUrls)
      console.log('[ClipboardManager] Wrote', validPaths.length, 'files to Linux clipboard')
      return true
    }
  } catch (error) {
    console.error('[ClipboardManager] Failed to write to system clipboard:', error)
    return false
  }
}

/**
 * 检查系统剪贴板是否包含文件
 * @returns 是否包含文件路径
 */
export function hasFilesInSystemClipboard(): boolean {
  const platform = os.platform()

  try {
    if (platform === 'darwin') {
      const buffer = clipboard.readBuffer('NSFilenamesPboardType')
      if (buffer && buffer.length > 0) return true

      const text = clipboard.readText()
      return text.startsWith('file://')
    } else if (platform === 'win32') {
      const buffer = clipboard.readBuffer('FileNameW')
      return buffer && buffer.length > 0
    } else {
      const text = clipboard.readText()
      return text.includes('file://')
    }
  } catch {
    return false
  }
}

/**
 * 清空系统剪贴板
 */
export function clearSystemClipboard(): void {
  try {
    clipboard.clear()
    console.log('[ClipboardManager] System clipboard cleared')
  } catch (error) {
    console.error('[ClipboardManager] Failed to clear system clipboard:', error)
  }
}
