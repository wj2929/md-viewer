import { createServer, type Server } from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDoctorResult } from '../cli/doctorCommand'

let server: Server | null = null

function listen(server: Server): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })
}

async function startHealthServer(): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version: '0.2.0', mode: 'full' }))
      return
    }

    res.writeHead(404)
    res.end()
  })
  return listen(server)
}

afterEach(async () => {
  if (!server) return
  await new Promise<void>(resolve => server?.close(() => resolve()))
  server = null
})

describe('buildDoctorResult', () => {
  it('reports local runtime capabilities without requiring a DOCX service', async () => {
    const result = await buildDoctorResult({})

    expect(result).toMatchObject({
      ok: true,
      command: 'doctor',
      summary: {
        status: expect.any(String),
        platform: process.platform,
      },
      results: {
        runtime: {
          platform: process.platform,
          arch: process.arch,
        },
      },
    })
  })

  it('checks a configured DOCX service health endpoint', async () => {
    const serviceUrl = await startHealthServer()

    const result = await buildDoctorResult({ 'docx-service': serviceUrl })

    expect(result.ok).toBe(true)
    expect(result.results.docxService).toMatchObject({
      ok: true,
      url: serviceUrl,
      version: '0.2.0',
      mode: 'full',
    })
  })
})
