import { net, type Session } from 'electron'
import { pathToFileURL } from 'node:url'
import * as fs from 'fs-extra'
import { open } from 'node:fs/promises'
import { constants, type BigIntStats } from 'node:fs'
import { sameTextFile } from './localTextSnapshot'
import { IMAGE_MIME_TYPES } from '../shared/localMedia'

const MAX_LOCAL_IMAGE_SIZE = 10 * 1024 * 1024

export interface LocalImageCapability {
  canonicalPath: string
  expiresAt: number
  workspace?: { canonicalRoot: string; workspaceId: string; lifecycleEpoch: number; info: BigIntStats; validate: () => Promise<void> }
}

const capabilityMaps = new WeakMap<Session, Map<string, LocalImageCapability>>()

export function getLocalImageCapabilities(targetSession: Session): Map<string, LocalImageCapability> {
  let capabilities = capabilityMaps.get(targetSession)
  if (!capabilities) {
    capabilities = new Map()
    capabilityMaps.set(targetSession, capabilities)
  }
  return capabilities
}

export function registerLocalImageProtocol(targetSession: Session): void {
  const capabilities = getLocalImageCapabilities(targetSession)
  targetSession.protocol.handle('local-image', async (request) => {
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })

    let token: string
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset' || url.search || url.hash) return new Response('Invalid URL', { status: 400 })
      const match = url.pathname.match(/^\/([A-Za-z0-9_-]{43})$/)
      if (!match) return new Response('Invalid URL', { status: 400 })
      token = match[1]
    } catch {
      return new Response('Invalid URL', { status: 400 })
    }

    const capability = capabilities.get(token)
    if (!capability || capability.expiresAt <= Date.now()) {
      capabilities.delete(token)
      return new Response('Forbidden', { status: 403 })
    }

    try {
      if (capability.workspace) {
        const scope = capability.workspace
        await scope.validate()
        const file = await open(capability.canonicalPath, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
        try {
          const before = await file.stat({ bigint: true })
          if (!before.isFile() || before.size > BigInt(MAX_LOCAL_IMAGE_SIZE) || !sameTextFile(before, scope.info)) throw new Error('stale')
          const bytes = Buffer.alloc(Number(before.size) + 1)
          let length = 0
          while (length < bytes.length) {
            const read = await file.read(bytes, length, bytes.length - length, length)
            if (!read.bytesRead) break
            length += read.bytesRead
          }
          if (BigInt(length) !== before.size || !sameTextFile(before, await file.stat({ bigint: true }))) throw new Error('stale')
          await scope.validate()
          const extension = capability.canonicalPath.slice(capability.canonicalPath.lastIndexOf('.')).toLowerCase()
          return new Response(new Uint8Array(bytes.subarray(0, length)), { headers: {
            'Content-Type': IMAGE_MIME_TYPES[extension] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          } })
        } finally { await file.close() }
      }
      const stats = await fs.stat(capability.canonicalPath)
      if (!stats.isFile() || stats.size > MAX_LOCAL_IMAGE_SIZE) {
        capabilities.delete(token)
        return new Response('Not Found', { status: 404 })
      }
      return net.fetch(pathToFileURL(capability.canonicalPath).toString())
    } catch {
      capabilities.delete(token)
      return new Response('Not Found', { status: 404 })
    }
  })
}

export function revokeLocalImageCapabilities(targetSession: Session): void {
  capabilityMaps.get(targetSession)?.clear()
  capabilityMaps.delete(targetSession)
}
