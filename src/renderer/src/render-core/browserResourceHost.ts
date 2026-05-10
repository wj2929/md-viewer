import { normalizeRenderPath, type ResourceHost } from './hosts'

interface BrowserResource {
  path: string
  kind: 'text' | 'binary'
  content?: string
  base64?: string
  mediaType: string
  size: number
}

function normalizeRefPath(refPath: string): string {
  return refPath.split('#')[0].split('?')[0].replace(/\\/g, '/')
}

function resolveRelativePath(basePath: string | undefined, refPath: string): string {
  const cleanRef = normalizeRefPath(refPath)
  if (!basePath) return cleanRef
  const cleanBase = normalizeRenderPath(basePath)
  const baseDir = cleanBase.includes('/') ? cleanBase.slice(0, cleanBase.lastIndexOf('/')) : ''
  return normalizeRenderPath(baseDir ? `${baseDir}/${cleanRef}` : cleanRef)
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

export function createBrowserResourceHost(input: { resources?: BrowserResource[] } = {}): ResourceHost {
  const resources = new Map(
    (input.resources || []).map((resource) => [normalizeRenderPath(resource.path), resource])
  )

  return {
    resolvePath(basePath: string | undefined, refPath: string) {
      return resolveRelativePath(basePath, refPath)
    },
    async readText(path: string) {
      const key = normalizeRenderPath(path)
      const resource = resources.get(key)
      if (!resource) throw new Error(`Resource not found: ${key}`)
      if (resource.kind !== 'text' || resource.content === undefined) {
        throw new Error(`Resource is not text: ${key}`)
      }
      return resource.content
    },
    async readBinary(path: string) {
      const key = normalizeRenderPath(path)
      const resource = resources.get(key)
      if (!resource) throw new Error(`Resource not found: ${key}`)
      if (resource.kind === 'text') {
        return new TextEncoder().encode(resource.content || '').buffer
      }
      if (!resource.base64) throw new Error(`Resource is missing base64 content: ${key}`)
      return decodeBase64(resource.base64)
    },
  }
}
