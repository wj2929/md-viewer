import { net, type Session } from 'electron'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import * as fs from 'fs-extra'
import {
  MAX_LOCAL_MEDIA_SIZE,
  localMediaMimeType,
  type LocalMediaKind,
} from '../shared/localMedia'
import { validateSecurePathInBase } from './security'

export const LOCAL_MEDIA_CAPABILITY_TTL_MS = 8 * 60 * 60 * 1000
export const MAX_LOCAL_MEDIA_CAPABILITIES_PER_SESSION = 500

export interface LocalMediaCapability {
  canonicalPath: string
  canonicalRoot: string
  workspaceId: string
  lifecycleEpoch: number
  kind: LocalMediaKind
  mimeType: string
  expiresAt: number
}

export type LocalMediaAuthorizationCheck = (capability: LocalMediaCapability) => boolean

const capabilityMaps = new WeakMap<Session, Map<string, LocalMediaCapability>>()
interface LocalMediaHttpServerState {
  server: Server
  routePrefix: string
  port: Promise<number>
}
const localMediaHttpServers = new WeakMap<Session, LocalMediaHttpServerState>()

export function getLocalMediaCapabilities(targetSession: Session): Map<string, LocalMediaCapability> {
  let capabilities = capabilityMaps.get(targetSession)
  if (!capabilities) {
    capabilities = new Map()
    capabilityMaps.set(targetSession, capabilities)
  }
  return capabilities
}

export function registerLocalMediaProtocol(
  targetSession: Session,
  isStillAuthorized: LocalMediaAuthorizationCheck,
): void {
  const capabilities = getLocalMediaCapabilities(targetSession)
  if (typeof targetSession.protocol.registerHttpProtocol === 'function') {
    const routePrefix = `/mdv-${randomBytes(32).toString('base64url')}`
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        const incomingUrl = new URL(
          incoming.url ?? '/',
          'http://127.0.0.1',
        )
        if (!incomingUrl.pathname.startsWith(`${routePrefix}/`)) {
          outgoing.writeHead(404)
          outgoing.end()
          return
        }
        const localUrl = `local-media://${incomingUrl.pathname.slice(routePrefix.length + 1)}${incomingUrl.search}`
        const parsedUrl = parseCapabilityUrl(localUrl)
        const capability = parsedUrl
          ? capabilities.get(parsedUrl.token)
          : undefined
        if (
          !parsedUrl
          || !capability
          || capability.expiresAt <= Date.now()
          || !isStillAuthorized(capability)
        ) {
          outgoing.writeHead(403)
          outgoing.end()
          return
        }
        try {
          const canonicalPath = await validateSecurePathInBase(
            capability.canonicalPath,
            capability.canonicalRoot,
          )
          const stats = await fs.stat(canonicalPath)
          const mimeType = localMediaMimeType(canonicalPath, capability.kind)
          if (
            canonicalPath !== capability.canonicalPath
            || !stats.isFile()
            || stats.size <= 0
            || stats.size > MAX_LOCAL_MEDIA_SIZE
            || mimeType !== capability.mimeType
          ) {
            outgoing.writeHead(404)
            outgoing.end()
            return
          }
          const selectedRange = parseByteRange(
            incoming.headers.range ?? null,
            stats.size,
          )
          if (selectedRange === 'invalid') {
            outgoing.writeHead(416, {
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes */${stats.size}`,
            })
            outgoing.end()
            return
          }
          capability.expiresAt = Date.now() + LOCAL_MEDIA_CAPABILITY_TTL_MS
          const start = selectedRange?.start ?? 0
          const end = selectedRange?.end ?? stats.size - 1
          const status = selectedRange ? 206 : 200
          const headers: Record<string, string> = {
            'Accept-Ranges': 'bytes',
            'Content-Type': capability.mimeType,
            'Content-Length': String(end - start + 1),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }
          if (selectedRange) headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
          outgoing.writeHead(status, headers)
          if (incoming.method === 'HEAD') {
            outgoing.end()
            return
          }
          const stream = createReadStream(canonicalPath, { start, end })
          stream.once('error', () => outgoing.destroy())
          outgoing.once('close', () => stream.destroy())
          stream.pipe(outgoing)
        } catch {
          outgoing.writeHead(404)
          outgoing.end()
        }
      })()
    })
    const serverReady = new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('本地媒体 HTTP 服务未取得监听地址'))
          return
        }
        resolve(address.port)
      })
    })
    localMediaHttpServers.set(targetSession, {
      server,
      routePrefix,
      port: serverReady,
    })
    targetSession.protocol.registerHttpProtocol('local-media', (request, callback) => {
      void serverReady.then(port => {
        const url = new URL(request.url)
        callback({
          url: `http://127.0.0.1:${port}${routePrefix}/${url.hostname}${url.pathname}${url.search}`,
        })
      }).catch(() => callback({ error: -6 }))
    })
    return
  }
  if (typeof targetSession.protocol.registerFileProtocol === 'function') {
    targetSession.protocol.registerFileProtocol('local-media', (request, callback) => {
      void (async () => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          callback({ error: -3 })
          return
        }
        const parsedUrl = parseCapabilityUrl(request.url)
        if (!parsedUrl) {
          callback({ error: -6 })
          return
        }
        const capability = capabilities.get(parsedUrl.token)
        if (
          !capability
          || capability.expiresAt <= Date.now()
          || !isStillAuthorized(capability)
        ) {
          capabilities.delete(parsedUrl.token)
          callback({ error: -6 })
          return
        }
        try {
          const canonicalPath = await validateSecurePathInBase(
            capability.canonicalPath,
            capability.canonicalRoot,
          )
          if (canonicalPath !== capability.canonicalPath) {
            capabilities.delete(parsedUrl.token)
            callback({ error: -6 })
            return
          }
          const stats = await fs.stat(canonicalPath)
          const mimeType = localMediaMimeType(canonicalPath, capability.kind)
          if (
            !stats.isFile()
            || stats.size <= 0
            || stats.size > MAX_LOCAL_MEDIA_SIZE
            || mimeType !== capability.mimeType
            || parseByteRange(
              request.headers.Range ?? request.headers.range ?? null,
              stats.size,
            ) === 'invalid'
          ) {
            capabilities.delete(parsedUrl.token)
            callback({ error: -6 })
            return
          }
          capability.expiresAt = Date.now() + LOCAL_MEDIA_CAPABILITY_TTL_MS
          callback({
            path: canonicalPath,
            mimeType: capability.mimeType,
            method: request.method,
          })
        } catch {
          capabilities.delete(parsedUrl.token)
          callback({ error: -6 })
        }
      })()
    })
    return
  }
  if (typeof targetSession.protocol.registerStreamProtocol === 'function') {
    targetSession.protocol.registerStreamProtocol('local-media', (request, callback) => {
      void (async () => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          callback({ statusCode: 405, headers: { Allow: 'GET, HEAD' } })
          return
        }
        const parsedUrl = parseCapabilityUrl(request.url)
        if (!parsedUrl) {
          callback({ statusCode: 400 })
          return
        }
        const capability = capabilities.get(parsedUrl.token)
        if (
          !capability
          || capability.expiresAt <= Date.now()
          || !isStillAuthorized(capability)
        ) {
          capabilities.delete(parsedUrl.token)
          callback({ statusCode: 403 })
          return
        }
        try {
          const canonicalPath = await validateSecurePathInBase(
            capability.canonicalPath,
            capability.canonicalRoot,
          )
          if (canonicalPath !== capability.canonicalPath) {
            capabilities.delete(parsedUrl.token)
            callback({ statusCode: 404 })
            return
          }
          const stats = await fs.stat(canonicalPath)
          const mimeType = localMediaMimeType(canonicalPath, capability.kind)
          if (
            !stats.isFile()
            || stats.size <= 0
            || stats.size > MAX_LOCAL_MEDIA_SIZE
            || mimeType !== capability.mimeType
          ) {
            capabilities.delete(parsedUrl.token)
            callback({ statusCode: 404 })
            return
          }
          const rangeValue = request.headers.Range ?? request.headers.range ?? null
          const selectedRange = parseByteRange(rangeValue, stats.size)
          if (selectedRange === 'invalid') {
            callback({
              statusCode: 416,
              headers: {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${stats.size}`,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            })
            return
          }
          capability.expiresAt = Date.now() + LOCAL_MEDIA_CAPABILITY_TTL_MS
          const start = selectedRange?.start ?? 0
          const end = selectedRange?.end ?? stats.size - 1
          const status = selectedRange ? 206 : 200
          const headers: Record<string, string> = {
            'Accept-Ranges': 'bytes',
            'Content-Type': capability.mimeType,
            'Content-Length': String(end - start + 1),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }
          if (selectedRange) headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
          if (request.method === 'HEAD') {
            callback({ statusCode: status, headers })
            return
          }
          const stream = createReadStream(canonicalPath, { start, end })
          console.info('[LocalMediaProtocol] stream-protocol:start', {
            status,
            start,
            end,
            requestedBytes: end - start + 1,
          })
          stream.once('error', (error) => {
            console.warn('[LocalMediaProtocol] stream-protocol:error', {
              start,
              end,
              bytesRead: stream.bytesRead,
              error: error instanceof Error ? error.message : String(error),
            })
          })
          stream.once('close', () => {
            console.info('[LocalMediaProtocol] stream-protocol:close', {
              start,
              end,
              requestedBytes: end - start + 1,
              bytesRead: stream.bytesRead,
            })
          })
          callback({ statusCode: status, headers, data: stream })
        } catch {
          capabilities.delete(parsedUrl.token)
          callback({ statusCode: 404 })
        }
      })()
    })
    return
  }
  targetSession.protocol.handle('local-media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      })
    }

    const parsedUrl = parseCapabilityUrl(request.url)
    if (!parsedUrl) return new Response('Invalid URL', { status: 400 })

    const capability = capabilities.get(parsedUrl.token)
    if (
      !capability
      || capability.expiresAt <= Date.now()
      || !isStillAuthorized(capability)
    ) {
      capabilities.delete(parsedUrl.token)
      return new Response('Forbidden', { status: 403 })
    }

    try {
      const canonicalPath = await validateSecurePathInBase(
        capability.canonicalPath,
        capability.canonicalRoot,
      )
      if (canonicalPath !== capability.canonicalPath) {
        capabilities.delete(parsedUrl.token)
        return new Response('Not Found', { status: 404 })
      }

      const stats = await fs.stat(canonicalPath)
      const mimeType = localMediaMimeType(canonicalPath, capability.kind)
      if (
        !stats.isFile()
        || stats.size <= 0
        || stats.size > MAX_LOCAL_MEDIA_SIZE
        || mimeType !== capability.mimeType
      ) {
        capabilities.delete(parsedUrl.token)
        return new Response('Not Found', { status: 404 })
      }

      const selectedRange = parseByteRange(request.headers.get('range'), stats.size)
      if (selectedRange === 'invalid') {
        return new Response(null, {
          status: 416,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${stats.size}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      capability.expiresAt = Date.now() + LOCAL_MEDIA_CAPABILITY_TTL_MS
      const start = selectedRange?.start ?? 0
      const end = selectedRange?.end ?? stats.size - 1
      const status = selectedRange ? 206 : 200
      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': capability.mimeType,
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }
      if (selectedRange) headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`

      if (request.method === 'HEAD') return new Response(null, { status, headers })

      let body: ReadableStream<Uint8Array>
      if (process.versions.electron) {
        return fetchLocalMediaThroughNativeHttp({
          canonicalPath,
          mimeType: capability.mimeType,
          size: stats.size,
          start,
          end,
          status,
        })
      } else {
        const nodeStream = createReadStream(canonicalPath, { start, end })
        const iterator = nodeStream[Symbol.asyncIterator]()
        let settled = false
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
        const closeFallbackStream = (): void => {
          if (settled) return
          settled = true
          nodeStream.push(null)
          nodeStream.close()
        }
        const abortFallbackStream = (): void => {
          if (!settled) controllerRef?.close()
          closeFallbackStream()
        }
        if (request.signal.aborted) {
          abortFallbackStream()
        } else {
          request.signal.addEventListener('abort', abortFallbackStream, { once: true })
          nodeStream.once('close', () => {
            request.signal.removeEventListener('abort', abortFallbackStream)
          })
        }
        body = new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller
          },
          async pull(controller) {
            if (settled) return
            try {
              const { value, done } = await iterator.next()
              if (settled) return
              if (done) {
                settled = true
                controller.close()
                return
              }
              controller.enqueue(
                new Uint8Array(
                  typeof value === 'string' ? Buffer.from(value) : value,
                ),
              )
            } catch (error) {
              if (settled) return
              settled = true
              controller.error(error)
            }
          },
          cancel: closeFallbackStream,
        })
      }
      return new Response(body, { status, headers })
    } catch {
      capabilities.delete(parsedUrl.token)
      return new Response('Not Found', { status: 404 })
    }
  })
}

interface NativeMediaHttpRequest {
  canonicalPath: string
  mimeType: string
  size: number
  start: number
  end: number
  status: number
}

async function fetchLocalMediaThroughNativeHttp({
  canonicalPath,
  mimeType,
  size,
  start,
  end,
  status,
}: NativeMediaHttpRequest): Promise<Response> {
  const route = `/${randomBytes(32).toString('base64url')}`
  let server: Server | null = null
  let serverClosed = false
  const closeServer = (): void => {
    if (serverClosed) return
    serverClosed = true
    server?.close()
  }

  server = createServer((incoming, outgoing) => {
    if (incoming.method !== 'GET' || incoming.url !== route) {
      outgoing.writeHead(404)
      outgoing.end()
      closeServer()
      return
    }

    const fileStream = createReadStream(canonicalPath, { start, end })
    console.info('[LocalMediaProtocol] native-http:start', {
      status,
      start,
      end,
      requestedBytes: end - start + 1,
    })
    outgoing.writeHead(status, {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
      'Content-Length': String(end - start + 1),
      ...(status === 206
        ? { 'Content-Range': `bytes ${start}-${end}/${size}` }
        : {}),
    })
    fileStream.once('error', () => outgoing.destroy())
    outgoing.once('close', () => {
      console.info('[LocalMediaProtocol] native-http:close', {
        start,
        end,
        requestedBytes: end - start + 1,
        bytesRead: fileStream.bytesRead,
      })
      fileStream.destroy()
      closeServer()
    })
    outgoing.once('finish', closeServer)
    fileStream.pipe(outgoing)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server?.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server?.off('error', onError)
        resolve()
      }
      server!.once('error', onError)
      server!.once('listening', onListening)
      server!.listen(0, '127.0.0.1')
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('本地媒体流服务未取得监听地址')
    }
    const response = await net.fetch(
      `http://127.0.0.1:${address.port}${route}`,
    )
    if (!response.body) throw new Error('本地媒体流服务未返回响应体')
    return response
  } catch (error) {
    closeServer()
    throw error
  }
}

export async function getLocalMediaCapabilityUrl(
  targetSession: Session,
  token: string,
): Promise<string> {
  const state = localMediaHttpServers.get(targetSession)
  if (!state) return `local-media://asset/${token}`
  const port = await state.port
  return `http://127.0.0.1:${port}${state.routePrefix}/asset/${token}`
}

export function revokeLocalMediaCapabilities(targetSession: Session): void {
  capabilityMaps.get(targetSession)?.clear()
  capabilityMaps.delete(targetSession)
  localMediaHttpServers.get(targetSession)?.server.close()
  localMediaHttpServers.delete(targetSession)
}

function parseCapabilityUrl(value: string): { token: string } | null {
  try {
    const url = new URL(value)
    if (url.hostname !== 'asset' || url.hash) return null
    if (url.search) {
      const instance = url.searchParams.get('instance')
      if (
        !instance
        || !/^\d{1,10}$/.test(instance)
        || [...url.searchParams.keys()].some(key => key !== 'instance')
      ) return null
    }
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{43})$/)
    return match ? { token: match[1] } : null
  } catch {
    return null
  }
}

export interface ByteRange {
  start: number
  end: number
}

export function parseByteRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null
  const match = value.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid'

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) return 'invalid'

  return { start, end: Math.min(requestedEnd, size - 1) }
}
