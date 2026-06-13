import { access, stat, writeFile } from 'fs/promises'
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

  const body = JSON.stringify({
    sourceType: 'markdown',
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
