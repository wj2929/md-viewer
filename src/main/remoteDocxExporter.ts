/**
 * 远程 DOCX 服务调用模块
 *
 * 向 md-viewer-docx-service 发送 POST /convert 请求，
 * 接收二进制 DOCX 响应并写入指定路径。
 */
import * as fs from 'fs-extra'
import { net } from 'electron'
import { appDataManager } from './appDataManager'

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
    throw new Error('远程 DOCX 服务未启用或未配置服务器地址')
  }

  const url = `${docxConfig.serverUrl.replace(/\/+$/, '')}/convert`
  const timeoutMs = docxConfig.timeoutMs || 60000

  const body = JSON.stringify({
    markdown,
    style: options.style || docxConfig.style || 'standard',
    title: options.title || undefined,
    footerText: options.footerText || '由 MD Viewer 生成',
    images: (options.images || []).map(img => ({
      id: img.id,
      pngBase64: img.pngBase64,
      widthCm: img.widthCm || 15.5,
    })),
    renderCharts: false,
    embedFont: options.embedFont ?? docxConfig.embedFont ?? false,
    clientVersion: '1.7.0',
  })

  return new Promise<RemoteConvertResult>((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`请求超时（${timeoutMs / 1000}s），请检查服务器状态`))
    }, timeoutMs)

    const request = net.request({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(docxConfig.apiKey ? { 'X-API-Key': docxConfig.apiKey } : {}),
      },
    })

    const chunks: Buffer[] = []
    let statusCode = 0
    let responseHeaders: Record<string, string> = {}

    request.on('response', (response) => {
      statusCode = response.statusCode
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key.toLowerCase()] = value
        } else if (Array.isArray(value) && value.length > 0) {
          responseHeaders[key.toLowerCase()] = value[0]
        }
      }

      response.on('data', (chunk) => {
        chunks.push(chunk)
      })

      response.on('end', async () => {
        clearTimeout(timer)
        const data = Buffer.concat(chunks)

        if (statusCode !== 200) {
          let errMsg = `服务端返回 ${statusCode}`
          try {
            const json = JSON.parse(data.toString('utf-8'))
            errMsg = json.error || json.detail?.error || errMsg
          } catch { /* not JSON */ }
          reject(new Error(errMsg))
          return
        }

        try {
          await fs.writeFile(outputPath, data)
          resolve({
            filePath: outputPath,
            warnings: parseWarnings(responseHeaders['x-convert-warnings']),
            serviceVersion: responseHeaders['x-service-version'] || 'unknown',
            imagesFailed: parseInt(responseHeaders['x-charts-failed'] || '0', 10),
            mode: responseHeaders['x-service-mode'] || 'unknown',
          })
        } catch (writeErr) {
          reject(new Error(`写入文件失败: ${writeErr}`))
        }
      })
    })

    request.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`无法连接服务器 ${docxConfig.serverUrl}: ${err.message}`))
    })

    request.write(body)
    request.end()
  })
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
  error?: string
}> {
  const url = `${serverUrl.replace(/\/+$/, '')}/healthz`

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: '连接超时（5s）' })
    }, 5000)

    const request = net.request({ method: 'GET', url })

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        clearTimeout(timer)
        if (response.statusCode !== 200) {
          resolve({ ok: false, error: `HTTP ${response.statusCode}` })
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
          })
        } catch {
          resolve({ ok: false, error: '响应格式不正确，请确认是 md-viewer-docx-service' })
        }
      })
    })

    request.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `无法连接: ${err.message}` })
    })

    request.end()
  })
}
