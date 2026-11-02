import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Session } from 'electron'
import { MAX_LOCAL_MEDIA_SIZE } from '../../shared/localMedia'
import {
  getLocalMediaCapabilities,
  parseByteRange,
  registerLocalMediaProtocol,
  revokeLocalMediaCapabilities,
  type LocalMediaCapability,
} from '../localMediaProtocol'

const temporaryDirectories: string[] = []

async function createProtocolHarness(isStillAuthorized: (capability: LocalMediaCapability) => boolean = () => true) {
  const temporaryRoot = path.join(process.cwd(), '.tmp')
  await mkdir(temporaryRoot, { recursive: true })
  const root = await mkdtemp(path.join(temporaryRoot, 'media-protocol-test-'))
  temporaryDirectories.push(root)
  const mediaPath = path.join(root, 'sample.mp3')
  await writeFile(mediaPath, Buffer.from('0123456789'))
  const canonicalRoot = await realpath(root)
  const canonicalPath = await realpath(mediaPath)
  let handler: ((request: Request) => Promise<Response>) | null = null
  const targetSession = {
    protocol: {
      handle: (_scheme: string, nextHandler: (request: Request) => Promise<Response>) => {
        handler = nextHandler
      },
    },
  } as unknown as Session
  registerLocalMediaProtocol(targetSession, isStillAuthorized)
  if (!handler) throw new Error('协议 handler 未注册')

  const token = 'A'.repeat(43)
  const capability: LocalMediaCapability = {
    canonicalPath,
    canonicalRoot,
    workspaceId: 'workspace-1',
    lifecycleEpoch: 1,
    kind: 'audio',
    mimeType: 'audio/mpeg',
    expiresAt: Date.now() + 60_000,
  }
  getLocalMediaCapabilities(targetSession).set(token, capability)

  return {
    targetSession,
    token,
    canonicalPath,
    canonicalRoot,
    handler: handler as (request: Request) => Promise<Response>,
  }
}

function protocolRequest(token: string, init: RequestInit = {}): Request {
  return new Request(`local-media://asset/${token}`, init)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('localMediaProtocol byte ranges', () => {
  it('accepts full, bounded, open and suffix ranges', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects malformed, multipart and unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=0-1,4-5', 100)).toBe('invalid')
    expect(parseByteRange('bytes=100-', 100)).toBe('invalid')
    expect(parseByteRange('bytes=9-3', 100)).toBe('invalid')
    expect(parseByteRange('bytes=-0', 100)).toBe('invalid')
    expect(parseByteRange('items=0-1', 100)).toBe('invalid')
  })
})

describe('localMediaProtocol responses', () => {
  it('accepts only the bounded renderer instance query parameter', async () => {
    const { token, handler } = await createProtocolHarness()
    expect((await handler(new Request(`local-media://asset/${token}?instance=42`))).status).toBe(200)
    expect((await handler(new Request(`local-media://asset/${token}?other=42`))).status).toBe(400)
    expect((await handler(new Request(`local-media://asset/${token}?instance=abc`))).status).toBe(400)
    expect((await handler(new Request(`local-media://asset/${token}#t=1`))).status).toBe(400)
  })

  it('streams full and ranged GET responses with fixed media headers', async () => {
    const { token, handler } = await createProtocolHarness()

    const full = await handler(protocolRequest(token))
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('audio/mpeg')
    expect(full.headers.get('content-length')).toBe('10')
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('cache-control')).toBe('no-store')
    expect(await full.text()).toBe('0123456789')

    const partial = await handler(protocolRequest(token, { headers: { Range: 'bytes=3-6' } }))
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(partial.headers.get('content-length')).toBe('4')
    expect(await partial.text()).toBe('3456')
  })

  it('closes an active file stream when the request is aborted', async () => {
    const { token, canonicalPath, handler } = await createProtocolHarness()
    const contentSize = 4 * 1024 * 1024
    await writeFile(canonicalPath, Buffer.alloc(contentSize, 0x61))
    const controller = new AbortController()
    const response = await handler(protocolRequest(token, { signal: controller.signal }))
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    controller.abort()

    let bytesRead = first.value?.byteLength ?? 0
    let readError: unknown = null
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytesRead += chunk.value.byteLength
      }
    } catch (error) {
      readError = error
    }
    expect(readError).toBeNull()
    expect(bytesRead).toBeLessThan(contentSize)
  })

  it('handles HEAD, invalid ranges and unsupported methods without media bytes', async () => {
    const { token, handler } = await createProtocolHarness()

    const head = await handler(protocolRequest(token, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')

    const invalidRange = await handler(protocolRequest(token, { headers: { Range: 'bytes=20-' } }))
    expect(invalidRange.status).toBe(416)
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10')
    expect(await invalidRange.text()).toBe('')

    const post = await handler(protocolRequest(token, { method: 'POST' }))
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  it('revokes a token when its canonical file is replaced by a symlink', async () => {
    const { targetSession, token, canonicalPath, canonicalRoot, handler } = await createProtocolHarness()
    const replacement = path.join(canonicalRoot, 'replacement.mp3')
    await writeFile(replacement, 'replacement')
    await unlink(canonicalPath)
    await symlink(replacement, canonicalPath)

    const response = await handler(protocolRequest(token))
    expect(response.status).toBe(404)
    expect(getLocalMediaCapabilities(targetSession).has(token)).toBe(false)
  })

  it('revokes capabilities when a media file becomes empty or oversized', async () => {
    const empty = await createProtocolHarness()
    await truncate(empty.canonicalPath, 0)
    expect((await empty.handler(protocolRequest(empty.token))).status).toBe(404)
    expect(getLocalMediaCapabilities(empty.targetSession).has(empty.token)).toBe(false)

    const oversized = await createProtocolHarness()
    await truncate(oversized.canonicalPath, MAX_LOCAL_MEDIA_SIZE + 1)
    expect((await oversized.handler(protocolRequest(oversized.token))).status).toBe(404)
    expect(getLocalMediaCapabilities(oversized.targetSession).has(oversized.token)).toBe(false)
  })

  it('rejects expired capabilities and workspace lifecycle invalidation', async () => {
    const expired = await createProtocolHarness()
    const expiredCapability = getLocalMediaCapabilities(expired.targetSession).get(expired.token)!
    expiredCapability.expiresAt = Date.now() - 1
    expect((await expired.handler(protocolRequest(expired.token))).status).toBe(403)
    expect(getLocalMediaCapabilities(expired.targetSession).has(expired.token)).toBe(false)

    const unauthorized = await createProtocolHarness(() => false)
    expect((await unauthorized.handler(protocolRequest(unauthorized.token))).status).toBe(403)
    expect(getLocalMediaCapabilities(unauthorized.targetSession).has(unauthorized.token)).toBe(false)
  })

  it('keeps capability maps isolated between Electron sessions', async () => {
    const first = await createProtocolHarness()
    const second = await createProtocolHarness()
    getLocalMediaCapabilities(second.targetSession).delete(second.token)

    expect((await second.handler(protocolRequest(first.token))).status).toBe(403)
    const authorized = await first.handler(protocolRequest(first.token))
    expect(authorized.status).toBe(200)
    expect(await authorized.text()).toBe('0123456789')
  })

  it('invalidates the handler-captured capability map when revoked', async () => {
    const { targetSession, token, handler } = await createProtocolHarness()
    revokeLocalMediaCapabilities(targetSession)

    const response = await handler(protocolRequest(token))
    expect(response.status).toBe(403)
    expect(getLocalMediaCapabilities(targetSession).size).toBe(0)
  })
})
