import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { resolveRemoteDocxStyle } from '../remoteDocxExporter'

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '1.7.0') },
}))

vi.mock('../appDataManager', () => ({
  appDataManager: {
    getSettings: vi.fn(),
  },
}))

let server: Server | null = null

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })
}

async function startDocxHealthServer(styles: string[]): Promise<string> {
  server = createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'Not Found' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      version: '0.1.0',
      mode: 'full',
      styles,
    }))
  })
  return listen(server)
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
    server = null
  })
})

describe('remoteDocxExporter style compatibility', () => {
  it('falls back from preview when the service only supports document styles', async () => {
    const serverUrl = await startDocxHealthServer(['official', 'internal', 'report', 'standard'])

    const result = await resolveRemoteDocxStyle({
      serverUrl,
      style: 'preview',
      styleTouched: true,
    })

    expect(result.style).toBe('standard')
    expect(result.warnings).toEqual([
      '当前 DOCX 服务不支持“预览一致”，已临时使用“通用 Word”导出。',
    ])
  })

  it('keeps a selected style that the service declares as supported', async () => {
    const serverUrl = await startDocxHealthServer(['official', 'internal', 'report', 'standard'])

    const result = await resolveRemoteDocxStyle({
      serverUrl,
      style: 'official',
      styleTouched: true,
    })

    expect(result).toEqual({ style: 'official', warnings: [] })
  })
})
