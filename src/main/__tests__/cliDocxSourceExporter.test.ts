import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import http, { type IncomingMessage, type ServerResponse } from 'http'
import path from 'path'
import { exportDocxViaConvertSource } from '../cli/docxSourceExporter'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('exportDocxViaConvertSource', () => {
  it('posts markdown to /convert-source and writes the returned DOCX', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-docx-source-'))
    const outputPath = path.join(tempDir, 'report.docx')
    let capturedBody: any = null

    const server = await startServer(async (req, res) => {
      expect(req.url).toBe('/convert-source')
      expect(req.headers['x-api-key']).toBe('secret')
      capturedBody = JSON.parse(await readRequestBody(req))
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'x-service-version': '0.2.2',
        'x-service-mode': 'fullFidelity',
        'x-render-status': 'success',
        'x-render-failed-blocks': '0',
        'x-charts-rendered': '2',
        'x-convert-warnings': '["\\u5b57\\u4f53\\u5df2\\u66ff\\u6362"]',
      })
      res.end(Buffer.from('fake-docx'))
    })

    try {
      const result = await exportDocxViaConvertSource({
        markdown: '# Report',
        outputPath,
        serviceUrl: server.url,
        apiKey: 'secret',
        style: 'preview',
        embedFont: true,
        timeoutMs: 5000,
      })

      expect(capturedBody).toMatchObject({
        sourceType: 'markdown',
        markdown: '# Report',
        style: 'preview',
        renderMode: 'fullFidelity',
        fallbackMode: 'partial',
        theme: 'light',
        embedFont: true,
      })
      expect(result).toMatchObject({
        artifact: {
          type: 'docx',
          path: outputPath,
        },
        warnings: ['字体已替换'],
        serviceVersion: '0.2.2',
        mode: 'fullFidelity',
        renderStatus: 'success',
        failedBlocks: 0,
        chartsRendered: 2,
      })
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('fake-docx')
      await expect(stat(outputPath)).resolves.toMatchObject({ size: 9 })
    } finally {
      await server.close()
    }
  })
})

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法启动测试 HTTP 服务')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
