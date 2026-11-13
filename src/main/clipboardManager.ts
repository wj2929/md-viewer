/**
 * 跨应用剪贴板管理器
 * @module clipboardManager
 * @description 系统剪贴板文件引用与主进程安全过滤。
 */

import { execFileSync } from 'child_process'
import { clipboard, ClipboardItem } from 'electron'
import * as os from 'os'
import * as fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { isProtectedPath } from './security'

export interface ClipboardFile {
  path: string
  exists: boolean
  isAllowed: boolean
  reason?: string
}

let clipboardWrites: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(write: () => T | Promise<T>): Promise<T> {
  const result = clipboardWrites.then(write)
  clipboardWrites = result.catch(() => undefined)
  return result
}

function osFormat(name: string): string {
  return `electron application/osclipboard;format="${name}"`
}

function parseFileUrls(text: string, windows: boolean): string[] {
  return text.split(/\r?\n/).flatMap(line => {
    try {
      const url = new URL(line.trim())
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return []
      return [fileURLToPath(url, { windows })]
    } catch {
      return []
    }
  })
}

/** 读取本身不授予跨根复制权限，实际粘贴仍按窗口来源授权校验。 */
export async function readFilesFromSystemClipboard(): Promise<ClipboardFile[]> {
  const platform = os.platform()
  let rawPaths: string[] = []
  try {
    const items = await clipboard.read()
    const payload = async (format: string): Promise<Buffer | undefined> => {
      const item = items.find(candidate => candidate.types.includes(format))
      if (!item) return undefined
      const blob = await item.getType(format)
      if (!('arrayBuffer' in blob)) return undefined
      return Buffer.from(await blob.arrayBuffer())
    }
    const urls = await payload('text/uri-list')
    if (urls) rawPaths = parseFileUrls(urls.toString('utf8'), platform === 'win32')
    if (!rawPaths.length && platform === 'darwin') {
      const buffer = await payload(osFormat('NSFilenamesPboardType'))
      const matches = buffer?.toString('utf8').match(/<string>([^<]+)<\/string>/g)
      if (matches) {
        rawPaths = matches.map(match => match.replace(/<\/?string>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      }
    } else if (!rawPaths.length && platform === 'win32') {
      const buffer = await payload(osFormat('FileNameW'))
      if (buffer) rawPaths = buffer.toString('utf16le').split('\0').filter(Boolean)
    } else if (!rawPaths.length) {
      const buffer = await payload(osFormat('x-special/gnome-copied-files'))
      if (buffer) rawPaths = parseFileUrls(buffer.toString('utf8'), false)
    }
    if (!rawPaths.length) rawPaths = parseFileUrls(await clipboard.readText(), platform === 'win32')
  } catch (error) {
    console.error('[ClipboardManager] Failed to read system clipboard:', error)
    return []
  }
  return rawPaths.map(path => {
    const exists = fs.existsSync(path)
    const isProtected = isProtectedPath(path)
    return {
      path,
      exists,
      isAllowed: exists && !isProtected,
      reason: !exists ? '文件不存在' : isProtected ? '受保护的系统路径' : undefined,
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
      stdio: 'ignore',
    })
    return true
  } catch (error) {
    console.error('[ClipboardManager] Failed to write Windows file clipboard:', error)
    return false
  }
}

export function writeFilesToSystemClipboard(paths: string[], isCut = false): Promise<boolean> {
  const requestedPaths = [...paths]
  return enqueueWrite(async () => {
    try {
      const validPaths = requestedPaths.filter(path => fs.existsSync(path))
      if (!validPaths.length) return false
      if (os.platform() === 'win32') return writeWindowsFilesToSystemClipboard(validPaths, isCut)
      const urls = validPaths.map(path => pathToFileURL(path, { windows: false }).href).join('\r\n')
      const data: Record<string, string> = { 'text/uri-list': urls }
      if (os.platform() === 'linux') {
        data[osFormat('x-special/gnome-copied-files')] = `${isCut ? 'cut' : 'copy'}\n${urls}\n`
      }
      await clipboard.write([new ClipboardItem(data)])
      return true
    } catch (error) {
      console.error('[ClipboardManager] Failed to write to system clipboard:', error)
      return false
    }
  })
}

/** 文本与文件写入共用顺序，旧文件写入不能覆盖较新的路径复制。 */
export function writeTextToSystemClipboard(text: string): Promise<boolean> {
  return enqueueWrite(async () => {
    try {
      await clipboard.writeText(text)
      return true
    } catch (error) {
      console.error('[ClipboardManager] Failed to write text:', error)
      return false
    }
  })
}

export async function hasFilesInSystemClipboard(): Promise<boolean> {
  return (await readFilesFromSystemClipboard()).length > 0
}

export function clearSystemClipboard(): Promise<void> {
  return enqueueWrite(() => {
    try {
      clipboard.clear()
    } catch (error) {
      console.error('[ClipboardManager] Failed to clear system clipboard:', error)
    }
  })
}
