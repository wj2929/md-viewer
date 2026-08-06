/**
 * CLI 导出专用：把 HTML 里引用本地图片的 <img src="相对路径"> 内嵌成 data:base64。
 *
 * GUI 侧内嵌逻辑（renderer/utils/exportHtml.ts 的 embedLocalImagesInHtml）依赖浏览器 DOM
 * 和 window.api.readLocalAssetBase64（走 IPC），CLI 的 headless 渲染管线完全绕过它，
 * 导致 CLI 导出的 HTML 图片仍是相对路径、换机打开必裂。这里在主进程侧提供等价能力。
 *
 * 安全：以 markdown 文件所在目录为根做 validateSecurePathInBase 校验
 * （realpath 边界 + validateNotProtected），阻止 ../ 越界与读取系统敏感文件。
 */

import * as path from 'path'
import * as fs from 'fs-extra'
import { validateSecurePathInBase } from './security'

const LOCAL_ASSET_MIME_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
])
const MAX_LOCAL_ASSET_SIZE = 10 * 1024 * 1024
const IMG_TAG_PATTERN = /<img\b[^>]*?\bsrc\s*=\s*"([^"]*)"[^>]*>/gi

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 仅内嵌本地相对/绝对路径图片；已是 data:/http(s):/blob: 或图表引用则跳过 */
function isEmbeddableLocalImageSrc(src: string): boolean {
  if (!src) return false
  if (/^(?:https?:|data:|blob:|local-image:|file:)/i.test(src)) return false
  if (/\.excalidraw(?:[?#].*)?$/i.test(src)) return false
  if (/\.bpmn(?:[?#].*)?$/i.test(src)) return false
  return /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(src)
}

function stripUrlSuffix(refPath: string): string {
  return refPath.replace(/[?#].*$/, '')
}

async function readAssetAsDataUri(
  markdownDir: string,
  rawSrc: string
): Promise<string | null> {
  const cleanRef = stripUrlSuffix(safeDecodeURIComponent(rawSrc))
  // 只处理相对路径；绝对路径 / URL scheme 一律跳过（保持与 GUI 内嵌一致的保守策略）
  if (!cleanRef || /^[a-z][a-z0-9+.-]*:/i.test(cleanRef) || path.isAbsolute(cleanRef)) {
    return null
  }

  const ext = path.extname(cleanRef).toLowerCase()
  const mimeType = LOCAL_ASSET_MIME_TYPES.get(ext)
  if (!mimeType) return null

  let resolvedPath: string
  try {
    resolvedPath = await validateSecurePathInBase(path.join(markdownDir, cleanRef), markdownDir)
  } catch {
    return null
  }

  const stats = await fs.stat(resolvedPath)
  if (!stats.isFile() || stats.size > MAX_LOCAL_ASSET_SIZE) return null

  const buffer = await fs.readFile(resolvedPath)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

/**
 * 把 html 中引用本地图片的 <img> src 替换为 data:base64。
 * 读取失败 / 越界 / 不支持格式的图片保持原样（与 GUI 内嵌失败时一致，不阻断导出）。
 */
export async function embedLocalImagesInExportedHtml(
  html: string,
  markdownFilePath: string
): Promise<string> {
  const markdownDir = path.dirname(path.resolve(markdownFilePath))

  const matches = [...html.matchAll(IMG_TAG_PATTERN)]
  if (matches.length === 0) return html

  // 去重 src，避免同图多次读盘
  const uniqueSrcs = new Set<string>()
  for (const match of matches) {
    const src = match[1]
    if (isEmbeddableLocalImageSrc(src)) uniqueSrcs.add(src)
  }
  if (uniqueSrcs.size === 0) return html

  const replacements = new Map<string, string>()
  for (const src of uniqueSrcs) {
    try {
      const dataUri = await readAssetAsDataUri(markdownDir, src)
      if (dataUri) replacements.set(src, dataUri)
    } catch {
      // 单张失败不影响其余，保持原 src
    }
  }
  if (replacements.size === 0) return html

  return html.replace(IMG_TAG_PATTERN, (fullTag, src: string) => {
    const dataUri = replacements.get(src)
    if (!dataUri) return fullTag
    return fullTag.replace(`src="${src}"`, `src="${dataUri}"`)
  })
}
