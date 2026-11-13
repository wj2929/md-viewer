import { app, type Session } from 'electron'
import { readFileSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const decompress = promisify(brotliDecompress)
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

interface RendererAsset {
  path: string
  compressedPath: string
  bytes: number
  compressedBytes: number
  sha256: string
  compressedSha256: string
}
interface AssetSession {
  listeners: Set<(error: RendererAssetError) => void>
}
const sessions = new WeakMap<Session, AssetSession>()
let assetMode: boolean | undefined
let manifestPromise: Promise<Map<string, RendererAsset>> | undefined

export class RendererAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererAssetError'
  }
}

function isAssetMode(): boolean {
  if (!app.isPackaged) return false
  if (assetMode !== undefined) return assetMode
  try {
    const manifest = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
    if (manifest.rendererAssetFormat !== undefined && manifest.rendererAssetFormat !== 1) throw new Error('Unsupported asset format')
    assetMode = manifest.rendererAssetFormat === 1
    return assetMode
  } catch {
    throw new RendererAssetError('Invalid packaged renderer asset mode')
  }
}

async function readManifest(): Promise<Map<string, RendererAsset>> {
  const file = path.join(app.getAppPath(), 'renderer-assets.json')
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('Invalid asset manifest file')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 1024) throw new Error('Invalid asset manifest')
  const entries = new Map<string, RendererAsset>()
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== 'string'
      || !/^out\/renderer\/[A-Za-z0-9_./-]+\.js$/.test(entry.path)
      || entry.path.split('/').some((part: string) => !part || part === '.' || part === '..')
      || entry.compressedPath !== entry.path + '.br'
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 24 * 1024 * 1024
      || !Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 1 || entry.compressedBytes > 16 * 1024 * 1024
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || typeof entry.compressedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.compressedSha256)
      || entries.has(entry.path)) throw new Error('Invalid asset manifest entry')
    entries.set(entry.path, entry)
  }
  return entries
}

export function registerRendererAssets(targetSession: Session): void {
  if (!isAssetMode() || sessions.has(targetSession)) return
  const state: AssetSession = { listeners: new Set() }
  const root = app.getAppPath()
  targetSession.protocol.handle('file', async request => {
    // Capture subscribers at request start: a late failure cannot poison the next render.
    const listeners = [...state.listeners]
    let relative = 'manifest'
    try {
      const url = new URL(request.url)
      relative = path.relative(root, fileURLToPath(url)).split(path.sep).join('/')
      const entries = await (manifestPromise ??= readManifest().catch(error => {
        manifestPromise = undefined
        throw error
      }))
      const entry = entries.get(relative)
      if (!entry) return targetSession.fetch(request, { bypassCustomProtocolHandlers: true })
      if (request.method !== 'GET' || url.search || url.hash) return new Response('Invalid asset request', { status: 400 })
      const file = path.join(root, entry.compressedPath)
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.compressedBytes) throw new Error('Invalid compressed asset file')
      const compressed = await readFile(file)
      if (compressed.length !== entry.compressedBytes || sha256(compressed) !== entry.compressedSha256) throw new Error('Compressed asset hash mismatch')
      const bytes = await decompress(compressed, { maxOutputLength: entry.bytes, chunkSize: Math.max(64, entry.bytes + 1) })
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('Decoded asset hash mismatch')
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }), { headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      } })
    } catch {
      const error = new RendererAssetError('Packaged renderer asset unavailable')
      for (const listener of listeners) listener(error)
      console.error('[RendererAssets] Load rejected:', relative.startsWith('out/renderer/') ? relative : 'asset manifest or URL')
      return new Response('Renderer asset unavailable', { status: 500 })
    }
  })
  sessions.set(targetSession, state)
}

export function watchRendererAssetFailures(targetSession: Session): {
  race<T>(operation: Promise<T>): Promise<T>
  dispose(): void
} {
  const state = sessions.get(targetSession)
  let disposed = false
  let failure: RendererAssetError | undefined
  let rejectFailure!: (error: RendererAssetError) => void
  const rejected = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  // A request may fail between two awaited renderer steps.
  void rejected.catch(() => undefined)
  const listener = (error: RendererAssetError) => {
    if (disposed || failure) return
    failure = error
    rejectFailure(error)
  }
  state?.listeners.add(listener)
  return {
    async race<T>(operation: Promise<T>): Promise<T> {
      const result = await Promise.race([operation, rejected])
      if (failure) throw failure
      return result
    },
    dispose() {
      disposed = true
      state?.listeners.delete(listener)
    },
  }
}
