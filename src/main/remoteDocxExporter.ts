/**
 * 远程 DOCX 服务调用模块
 *
 * 向 md-viewer-docx-service 发送 POST /convert 请求，
 * 接收二进制 DOCX 响应并写入指定路径。
 */
import * as fs from 'fs-extra'
import * as http from 'http'
import * as https from 'https'
import { app } from 'electron'
import { appDataManager } from './appDataManager'
import {
  DEFAULT_DOCX_STYLE,
  DOCX_STYLE_LABELS,
  FALLBACK_DOCX_STYLE,
  normalizeDocxStyle,
  type DocxStyle,
} from '../shared/docxStyles'

export interface RemoteImage {
  id: string
  pngBase64: string
  widthCm?: number
}

export interface RemoteConvertResult {
  filePath: string
  warnings: string[]
  serviceVersion: string
  imagesFailed: number
  mode: string
  style: DocxStyle
}

export type DocxErrorType = 'network' | 'timeout' | 'client_error' | 'server_error' | 'write_error' | 'unknown'

export interface DocxErrorDetail {
  errorType: DocxErrorType
  message: string
  statusCode?: number
  serverUrl: string
  serviceVersion?: string
  timestamp: string
  raw?: string
}

export class DocxExportError extends Error {
  detail: DocxErrorDetail
  constructor(detail: DocxErrorDetail) {
    super(detail.message)
    this.name = 'DocxExportError'
    this.detail = detail
  }
}

export interface RemoteDocxStyleConfig {
  serverUrl?: string
  apiKey?: string
  style?: string
  styleTouched?: boolean
}

export async function resolveRemoteDocxStyle(
  config: RemoteDocxStyleConfig,
  requestedStyle?: string
): Promise<{ style: DocxStyle; warnings: string[] }> {
  const selectedStyle = normalizeDocxStyle(requestedStyle || config.style || DEFAULT_DOCX_STYLE)

  if (selectedStyle !== 'preview' || !config.serverUrl) {
    return { style: selectedStyle, warnings: [] }
  }

  const health = await testConnection(config.serverUrl, config.apiKey)
  if (!health.ok) {
    return { style: selectedStyle, warnings: [] }
  }

  const supportsPreview = Array.isArray(health.styles) && health.styles.includes('preview')
  if (supportsPreview) {
    return { style: selectedStyle, warnings: [] }
  }

  if (config.styleTouched) {
    throw new DocxExportError({
      errorType: 'client_error',
      message: '当前 DOCX 服务不支持“预览一致”，请升级 md-viewer-docx-service。',
      serverUrl: config.serverUrl,
      serviceVersion: health.version,
      timestamp: new Date().toISOString(),
      raw: `styles=${(health.styles || []).join(',') || 'unknown'}`,
    })
  }

  return {
    style: FALLBACK_DOCX_STYLE,
    warnings: [
      `当前 DOCX 服务不支持“${DOCX_STYLE_LABELS.preview}”，已临时使用“${DOCX_STYLE_LABELS[FALLBACK_DOCX_STYLE]}”导出。建议升级 md-viewer-docx-service。`,
    ],
  }
}

export async function exportViaRemote(
  markdown: string,
  outputPath: string,
  options: {
    style?: string
    title?: string
    footerText?: string
    images?: RemoteImage[]
    embedFont?: boolean
  } = {}
): Promise<RemoteConvertResult> {
  const settings = appDataManager.getSettings()
  const docxConfig = settings.docxExport

  if (!docxConfig?.remoteEnabled || !docxConfig.serverUrl) {
    throw new DocxExportError({
      errorType: 'unknown',
      message: '远程 DOCX 服务未启用或未配置服务器地址',
      serverUrl: '',
      timestamp: new Date().toISOString(),
    })
  }

  const url = `${docxConfig.serverUrl.replace(/\/+$/, '')}/convert`
  const timeoutMs = docxConfig.timeoutMs || 60000
  const compatibility = await resolveRemoteDocxStyle(docxConfig, options.style)
  const effectiveStyle = compatibility.style

  const body = JSON.stringify({
    markdown,
    style: effectiveStyle,
    title: options.title || undefined,
    footerText: options.footerText || '由 MD Viewer 生成',
    images: (options.images || []).map(img => ({
      id: img.id,
      pngBase64: img.pngBase64,
      widthCm: img.widthCm || 15.5,
    })),
    renderCharts: false,
    embedFont: options.embedFont ?? docxConfig.embedFont ?? false,
    clientVersion: app.getVersion(),
    referenceDocxBase64: await readReferenceDocxBase64(docxConfig.referenceDocxPath),
  })

  const parsedUrl = new URL(url)
  const client = parsedUrl.protocol === 'https:' ? https : http

  return new Promise<RemoteConvertResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy()
      reject(new DocxExportError({
        errorType: 'timeout',
        message: `请求超时（${timeoutMs / 1000}s），文档可能过大或服务器繁忙`,
        serverUrl: docxConfig.serverUrl || '',
        timestamp: new Date().toISOString(),
      }))
    }, timeoutMs)

    const reqOptions: http.RequestOptions = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(docxConfig.apiKey ? { 'X-API-Key': docxConfig.apiKey } : {}),
      },
      timeout: timeoutMs,
    }

    const req = client.request(reqOptions, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))

      res.on('end', async () => {
        clearTimeout(timer)
        const data = Buffer.concat(chunks)
        const headers = res.headers

        if (res.statusCode !== 200) {
          let errBody = `HTTP ${res.statusCode}`
          try {
            const json = JSON.parse(data.toString('utf-8'))
            errBody = json.error || json.detail?.error || errBody
          } catch { /* not JSON */ }
          const code = res.statusCode || 0
          const errorType: DocxErrorType = code >= 500 ? 'server_error' : 'client_error'
          const message = code >= 500
            ? `服务处理出错：${errBody}`
            : `请求被拒绝：${errBody}`
          reject(new DocxExportError({
            errorType,
            message,
            statusCode: code,
            serverUrl: docxConfig.serverUrl || '',
            serviceVersion: (headers['x-service-version'] as string) || undefined,
            timestamp: new Date().toISOString(),
            raw: errBody,
          }))
          return
        }

        try {
          await fs.writeFile(outputPath, data)
          const warnings = [
            ...compatibility.warnings,
            ...parseWarnings(headers['x-convert-warnings'] as string | undefined),
          ]
          const minVer = headers['x-min-client-version'] as string | undefined
          if (minVer && compareVersions(app.getVersion(), minVer) < 0) {
            warnings.push(`文件已正常生成。建议升级客户端至 ≥ v${minVer} 以保持兼容性`)
          }
          resolve({
            filePath: outputPath,
            warnings,
            serviceVersion: (headers['x-service-version'] as string) || 'unknown',
            imagesFailed: parseInt((headers['x-charts-failed'] as string) || '0', 10),
            mode: (headers['x-service-mode'] as string) || 'unknown',
            style: effectiveStyle,
          })
        } catch (writeErr) {
          reject(new DocxExportError({
            errorType: 'write_error',
            message: `写入文件失败：${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            serverUrl: docxConfig.serverUrl || '',
            timestamp: new Date().toISOString(),
            raw: String(writeErr),
          }))
        }
      })
    })

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(new DocxExportError({
        errorType: 'network',
        message: `无法连接 DOCX 服务`,
        serverUrl: docxConfig.serverUrl || '',
        timestamp: new Date().toISOString(),
        raw: err.message,
      }))
    })

    req.on('timeout', () => {
      req.destroy()
      clearTimeout(timer)
      reject(new DocxExportError({
        errorType: 'timeout',
        message: `请求超时（${timeoutMs / 1000}s），文档可能过大或服务器繁忙`,
        serverUrl: docxConfig.serverUrl || '',
        timestamp: new Date().toISOString(),
      }))
    })

    req.write(body)
    req.end()
  })
}

async function readReferenceDocxBase64(referenceDocxPath?: string): Promise<string | undefined> {
  if (!referenceDocxPath) return undefined
  try {
    const stat = await fs.stat(referenceDocxPath)
    if (!stat.isFile() || stat.size > 15 * 1024 * 1024) return undefined
    const data = await fs.readFile(referenceDocxPath)
    return data.toString('base64')
  } catch {
    return undefined
  }
}

function compareVersions(a: string, b: string): number {
  const clean = (v: string) => (v || '').split('+')[0].split('-')[0].split('.').map(Number)
  const pa = clean(a)
  const pb = clean(b)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function parseWarnings(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw.replace(/'/g, '"'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return raw ? [raw] : []
  }
}

export async function testConnection(serverUrl: string, apiKey?: string): Promise<{
  ok: boolean
  version?: string
  mode?: string
  styles?: string[]
  fontsAvailable?: string[]
  embedFontSupported?: boolean
  chartRenderersAvailable?: string[]
  error?: string
}> {
  const url = `${serverUrl.replace(/\/+$/, '')}/healthz`
  const parsedUrl = new URL(url)
  const client = parsedUrl.protocol === 'https:' ? https : http

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: '连接超时（5s）' })
    }, 5000)

    const headers: Record<string, string> = {}
    if (apiKey) headers['X-API-Key'] = apiKey

    const req = client.get(url, { headers, timeout: 5000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timer)
        if (res.statusCode !== 200) {
          resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          return
        }
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          resolve({
            ok: true,
            version: json.version,
            mode: json.mode,
            styles: json.styles,
            fontsAvailable: json.fontsAvailable,
            embedFontSupported: json.embedFontSupported,
            chartRenderersAvailable: json.chartRenderersAvailable,
          })
        } catch {
          resolve({ ok: false, error: '响应格式不正确，请确认是 md-viewer-docx-service' })
        }
      })
    })

    req.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `无法连接: ${err.message}` })
    })

    req.on('timeout', () => {
      req.destroy()
      clearTimeout(timer)
      resolve({ ok: false, error: '连接超时（5s）' })
    })
  })
}
