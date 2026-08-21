import { access, readFile, stat, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import type { CliArtifact } from './types'

export interface ConvertSourceDocxOptions {
  markdown: string
  outputPath: string
  serviceUrl: string
  apiKey?: string
  style?: string
  embedFont?: boolean
  timeoutMs?: number
  /** 源 md 文件路径；提供时随请求上传本地图片资源（bundle 模式） */
  sourceFilePath?: string
  /** 多文件合并:预构造的 bundle(汇总资源 + 根级 entryPath),优先于 sourceFilePath */
  __mergedBundle?: { entryPath: string; resources: BundleImageResource[] }
}

const RASTER_IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
const LOCAL_IMAGE_REF_RE = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
// ``` 与 ~~~ 围栏均支持（backreference 配对），与服务端规则一致
const FENCED_CODE_RE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm
const LOCAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024

interface BundleImageResource {
  path: string
  kind: 'binary'
  base64: string
  mediaType: string
  size: number
}

/**
 * 收集 markdown 引用的本地光栅图片，作为 bundle 资源上传。
 * 读不到/越界/超限的引用不上传——服务端会对未解析的本地图片引用产生 warning（不再静默丢图）。
 */
async function collectLocalImageResources(
  markdown: string,
  sourceFilePath: string,
): Promise<BundleImageResource[]> {
  const baseDir = path.dirname(sourceFilePath)
  const fencedSpans: Array<[number, number]> = []
  for (const fence of markdown.matchAll(FENCED_CODE_RE)) {
    fencedSpans.push([fence.index ?? 0, (fence.index ?? 0) + fence[0].length])
  }
  const seen = new Set<string>()
  const resources: BundleImageResource[] = []
  for (const match of markdown.matchAll(LOCAL_IMAGE_REF_RE)) {
    const start = match.index ?? 0
    if (fencedSpans.some(([s, e]) => start >= s && start < e)) continue
    const ref = (match[1] || match[2] || '').trim()
    if (!ref || /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.includes('mdv__chart__')) continue
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, '')
    const mediaType = RASTER_IMAGE_MEDIA_TYPES[path.extname(clean).toLowerCase()]
    if (!mediaType) continue
    if (clean.startsWith('/') || clean.split('/').includes('..')) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    try {
      const data = await readFile(path.resolve(baseDir, clean))
      if (data.length === 0 || data.length > LOCAL_IMAGE_MAX_BYTES) continue
      resources.push({
        path: clean,
        kind: 'binary',
        base64: data.toString('base64'),
        mediaType,
        size: data.length,
      })
    } catch {
      // 文件读不到：不上传，服务端会告警"未随请求提供该资源"
    }
  }
  return resources
}

/** 单文件命名空间化处理的产物 */
export interface NamespacedPart {
  /** 图片引用已重写为 __partN__/... 的 markdown */
  markdown: string
  /** 该文件的本地图片资源(path 已带 __partN__/ 前缀) */
  resources: BundleImageResource[]
}

/**
 * 多文件合并 DOCX 用:把单个文件的本地图片引用重写成带命名空间前缀的根相对路径
 * (images/a.png → __part<index>__/images/a.png),并按该文件自身目录收集图片资源。
 * 这样多文件合并后同名图片不撞车,且服务端按归一化相对路径精确匹配(entryPath 设根级 index.md)。
 * 图表围栏(```mermaid 等内联源码)不含外部引用,随 markdown 原样保留。
 */
export async function namespaceLocalImages(
  markdown: string,
  sourceFilePath: string,
  partIndex: number,
): Promise<NamespacedPart> {
  const prefix = `__part${partIndex}__`
  const baseDir = path.dirname(sourceFilePath)
  const fencedSpans: Array<[number, number]> = []
  for (const fence of markdown.matchAll(FENCED_CODE_RE)) {
    fencedSpans.push([fence.index ?? 0, (fence.index ?? 0) + fence[0].length])
  }

  // 先扫描:决定哪些引用要重写(clean→带前缀 path),并收集资源
  const rewriteMap = new Map<string, string>() // clean → `${prefix}/${clean}`
  const resources: BundleImageResource[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(LOCAL_IMAGE_REF_RE)) {
    const start = match.index ?? 0
    if (fencedSpans.some(([s, e]) => start >= s && start < e)) continue
    const ref = (match[1] || match[2] || '').trim()
    if (!ref || /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.includes('mdv__chart__')) continue
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, '')
    const mediaType = RASTER_IMAGE_MEDIA_TYPES[path.extname(clean).toLowerCase()]
    if (!mediaType) continue
    if (clean.startsWith('/') || clean.split('/').includes('..')) continue
    const namespaced = `${prefix}/${clean}`
    rewriteMap.set(ref, namespaced)
    if (seen.has(clean)) continue
    seen.add(clean)
    try {
      const data = await readFile(path.resolve(baseDir, clean))
      if (data.length === 0 || data.length > LOCAL_IMAGE_MAX_BYTES) continue
      resources.push({
        path: namespaced,
        kind: 'binary',
        base64: data.toString('base64'),
        mediaType,
        size: data.length,
      })
    } catch {
      // 读不到不上传,服务端告警
    }
  }

  // 再替换:在非围栏区把图片引用的路径部分换成带前缀路径
  let result = ''
  let cursor = 0
  for (const match of markdown.matchAll(LOCAL_IMAGE_REF_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (fencedSpans.some(([s, e]) => start >= s && start < e)) continue
    const ref = (match[1] || match[2] || '').trim()
    const namespaced = rewriteMap.get(ref)
    if (!namespaced) continue
    result += markdown.slice(cursor, start)
    result += match[0].replace(ref, namespaced)
    cursor = end
  }
  result += markdown.slice(cursor)

  return { markdown: result, resources }
}

/**
 * 多文件合并 DOCX:各文件命名空间化后的 markdown 用 <!-- pagebreak --> 拼接,
 * 汇总所有资源,以单一 bundle 请求发给服务端(entryPath=index.md 根级)。
 */
export async function exportMergedDocxViaConvertSource(
  parts: NamespacedPart[],
  options: Omit<ConvertSourceDocxOptions, 'markdown' | 'sourceFilePath'>,
): Promise<ConvertSourceDocxResult> {
  const mergedMarkdown = parts.map(p => p.markdown).join('\n\n<!-- pagebreak -->\n\n')
  const mergedResources = parts.flatMap(p => p.resources)
  return exportDocxViaConvertSource({
    ...options,
    markdown: mergedMarkdown,
    // 预构造 bundle:直接传汇总资源 + 根级 entryPath,跳过单文件 collectLocalImageResources
    __mergedBundle: { entryPath: 'index.md', resources: mergedResources },
  } as ConvertSourceDocxOptions)
}

export interface ConvertSourceDocxResult {
  artifact: CliArtifact
  warnings: string[]
  serviceVersion: string
  mode: string
  renderStatus: string
  failedBlocks: number
  chartsRendered: number
}

export type DocxSourceExportErrorType =
  | 'network'
  | 'timeout'
  | 'client_error'
  | 'server_error'
  | 'write_error'
  | 'unknown'

export class DocxSourceExportError extends Error {
  errorType: DocxSourceExportErrorType
  statusCode?: number
  serverUrl: string
  raw?: string

  constructor(options: {
    errorType: DocxSourceExportErrorType
    message: string
    serverUrl: string
    statusCode?: number
    raw?: string
  }) {
    super(options.message)
    this.name = 'DocxSourceExportError'
    this.errorType = options.errorType
    this.statusCode = options.statusCode
    this.serverUrl = options.serverUrl
    this.raw = options.raw
  }
}

export async function exportDocxViaConvertSource(
  options: ConvertSourceDocxOptions,
): Promise<ConvertSourceDocxResult> {
  const serviceUrl = options.serviceUrl.replace(/\/+$/, '')
  await ensureOutputPathWritable(options.outputPath, serviceUrl)

  // 合并场景:调用方已预构造 bundle(汇总资源 + 根级 entryPath);否则走单文件收集
  const merged = options.__mergedBundle
  const localImageResources = merged
    ? merged.resources
    : options.sourceFilePath
      ? await collectLocalImageResources(options.markdown, options.sourceFilePath)
      : []
  const body = JSON.stringify({
    ...(merged
      ? { sourceType: 'bundle', entryPath: merged.entryPath, resources: merged.resources }
      : localImageResources.length > 0
        ? {
            sourceType: 'bundle',
            entryPath: path.basename(options.sourceFilePath!),
            resources: localImageResources,
          }
        : { sourceType: 'markdown' }),
    markdown: options.markdown,
    style: options.style || 'preview',
    renderMode: 'fullFidelity',
    fallbackMode: 'partial',
    theme: 'light',
    embedFont: options.embedFont ?? false,
    clientVersion: process.env.npm_package_version,
  })
  const url = new URL(`${serviceUrl}/convert-source`)
  const client = url.protocol === 'https:' ? https : http
  const timeoutMs = options.timeoutMs ?? 180000

  const data = await new Promise<{ buffer: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const requestOptions: http.RequestOptions = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(options.apiKey ? { 'X-API-Key': options.apiKey } : {}),
      },
      timeout: timeoutMs,
    }

    const req = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (res.statusCode !== 200) {
          const message = parseErrorMessage(buffer, res.statusCode)
          reject(new DocxSourceExportError({
            errorType: (res.statusCode || 0) >= 500 ? 'server_error' : 'client_error',
            message,
            serverUrl: serviceUrl,
            statusCode: res.statusCode,
            raw: buffer.toString('utf8').slice(0, 1000),
          }))
          return
        }
        resolve({ buffer, headers: res.headers })
      })
    })

    req.on('error', (error) => {
      reject(new DocxSourceExportError({
        errorType: 'network',
        message: '无法连接 DOCX 服务',
        serverUrl: serviceUrl,
        raw: error.message,
      }))
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new DocxSourceExportError({
        errorType: 'timeout',
        message: `请求 DOCX 服务超时（${timeoutMs / 1000}s）`,
        serverUrl: serviceUrl,
      }))
    })

    req.write(body)
    req.end()
  })

  try {
    await writeFile(options.outputPath, data.buffer)
  } catch (error) {
    throw new DocxSourceExportError({
      errorType: 'write_error',
      message: `写入 DOCX 文件失败：${error instanceof Error ? error.message : String(error)}`,
      serverUrl: serviceUrl,
      raw: String(error),
    })
  }

  const fileStat = await stat(options.outputPath)
  return {
    artifact: {
      type: 'docx',
      path: options.outputPath,
      bytes: fileStat.size,
    },
    warnings: parseWarnings(data.headers['x-convert-warnings'] as string | undefined),
    serviceVersion: (data.headers['x-service-version'] as string | undefined) || 'unknown',
    mode: (data.headers['x-service-mode'] as string | undefined) || 'unknown',
    renderStatus: (data.headers['x-render-status'] as string | undefined) || 'unknown',
    failedBlocks: parseInt((data.headers['x-render-failed-blocks'] as string | undefined) || '0', 10),
    chartsRendered: parseInt((data.headers['x-charts-rendered'] as string | undefined) || '0', 10),
  }
}

async function ensureOutputPathWritable(outputPath: string, serviceUrl: string): Promise<void> {
  try {
    await access(path.dirname(outputPath), fsConstants.W_OK)
  } catch (error) {
    throw new DocxSourceExportError({
      errorType: 'write_error',
      message: `输出目录不可写：${path.dirname(outputPath)}`,
      serverUrl: serviceUrl,
      raw: String(error),
    })
  }
}

function parseWarnings(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return raw ? [raw] : []
  }
}

function parseErrorMessage(buffer: Buffer, statusCode?: number): string {
  const raw = buffer.toString('utf8')
  try {
    const parsed = JSON.parse(raw)
    const detail = parsed.detail
    if (typeof parsed.error === 'string') return parsed.error
    if (typeof detail === 'string') return detail
    if (typeof detail?.error === 'string') return detail.error
  } catch {
    // 非 JSON 响应直接使用下方兜底。
  }
  return raw || `DOCX 服务返回 HTTP ${statusCode ?? 'unknown'}`
}
