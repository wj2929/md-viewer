/**
 * 跨应用剪贴板管理器
 * @module clipboardManager
 * @description v1.3 阶段 6 - 系统剪贴板双向同步 + 主进程安全过滤
 */

import { execFileSync } from 'child_process'
import { clipboard } from 'electron'
import * as os from 'os'
import * as fs from 'fs'
import { pathToFileURL } from 'url'
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
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
          rawPaths = matches.map(m => unescapeXml(m.replace(/<\/?string>/g, '')))
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
      // Linux: 优先读取 GNOME 的 x-special/gnome-copied-files 格式
      try {
        const gnomeBuffer = clipboard.readBuffer('x-special/gnome-copied-files')
        if (gnomeBuffer && gnomeBuffer.length > 0) {
          // 格式: "copy\nfile:///path1\nfile:///path2" 或 "cut\nfile:///path1"
          const lines = gnomeBuffer.toString('utf8').split('\n')
          // 第一行是 'copy' 或 'cut'，跳过
          rawPaths = lines.slice(1)
            .filter(line => line.startsWith('file://'))
            .map(line => {
              try {
                return decodeURIComponent(new URL(line.trim()).pathname)
              } catch {
                return decodeURIComponent(line.trim().replace('file://', ''))
              }
            })
        }
      } catch {
        // GNOME 格式不可用，降级到 text/uri-list
      }

      // 降级：读取纯文本中的 file:// URI
      if (rawPaths.length === 0) {
        const text = clipboard.readText()
        if (text.includes('file://')) {
          rawPaths = text.split('\n')
            .filter(line => line.startsWith('file://'))
            .map(line => decodeURIComponent(line.replace('file://', '')))
        }
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

function writeWindowsFilesToSystemClipboard(paths: string[], isCut: boolean): boolean {
  const script = `
$paths = @($env:MD_VIEWER_CLIPBOARD_PATHS | ConvertFrom-Json)
Add-Type -AssemblyName System.Windows.Forms
$files = New-Object System.Collections.Specialized.StringCollection
$paths | ForEach-Object { [void]$files.Add($_) }
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($files)
$effect = [byte[]]@(${isCut ? 2 : 1}, 0, 0, 0)
$data.SetData('Preferred DropEffect', $effect)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`

  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-Command', script], {
      env: { ...process.env, MD_VIEWER_CLIPBOARD_PATHS: JSON.stringify(paths) },
      stdio: 'ignore'
    })
    return true
  } catch (error) {
    console.error('[ClipboardManager] Failed to write Windows file clipboard:', error)
    return false
  }
}

/**
 * 将文件路径写入系统剪贴板
 * @param paths - 文件路径列表
 * @param isCut - 是否为剪切操作
 */
export function writeFilesToSystemClipboard(paths: string[], isCut: boolean = false): boolean {
  const platform = os.platform()

  try {
    const validPaths = paths.filter(p => fs.existsSync(p))
    if (validPaths.length === 0) {
      console.warn('[ClipboardManager] No valid paths to write')
      return false
    }

    if (platform === 'darwin') {
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${validPaths.map(p => `  <string>${escapeXml(p)}</string>`).join('\n')}
</array>
</plist>`
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistContent, 'utf8'))
      return true
    }

    if (platform === 'win32') {
      return writeWindowsFilesToSystemClipboard(validPaths, isCut)
    }

    const operation = isCut ? 'cut' : 'copy'
    const fileUrls = validPaths.map(p => pathToFileURL(p).href).join('\r\n')
    clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`${operation}\n${fileUrls}\n`, 'utf8'))
    return true
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
