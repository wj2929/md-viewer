import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fsExtra from 'fs-extra'
import { exportViaRemote, resolveRemoteDocxStyle } from '../remoteDocxExporter'
import { appDataManager } from '../appDataManager'

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '1.7.0') },
}))

vi.mock('fs-extra', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs-extra')>()
  return {
    ...actual,
    default: actual,
    access: vi.fn(actual.access),
  }
})

vi.mock('../appDataManager', () => ({
  appDataManager: {
    getSettings: vi.fn(),
  },
}))

let server: Server | null = null
let tempDir: string | null = null

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

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
    server = null
  })
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
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

describe('remoteDocxExporter output path preflight', () => {
  it('fails before calling the remote service when the target docx file is not writable', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-docx-permission-'))
    const outputPath = path.join(tempDir, 'locked.docx')
    await writeFile(outputPath, 'old')
    await chmod(outputPath, 0o444)
    const accessError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    vi.mocked(fsExtra.access).mockRejectedValueOnce(accessError)
    vi.mocked(appDataManager.getSettings).mockReturnValue({
      docxExport: {
        remoteEnabled: true,
        serverUrl: 'http://127.0.0.1:9',
        style: 'preview',
      },
    } as any)

    await expect(exportViaRemote('# Report', outputPath)).rejects.toMatchObject({
      detail: {
        errorType: 'write_error',
        message: expect.stringContaining('目标文件不可写'),
      },
    })
  })
})
