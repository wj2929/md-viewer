import { net, type Session } from 'electron'
import { pathToFileURL } from 'node:url'
import * as fs from 'fs-extra'

const MAX_LOCAL_IMAGE_SIZE = 10 * 1024 * 1024

export interface LocalImageCapability {
  canonicalPath: string
  expiresAt: number
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
  capabilityMaps.delete(targetSession)
}
