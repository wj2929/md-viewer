export interface ResourceHost {
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<ArrayBuffer>
  resolvePath(basePath: string | undefined, refPath: string): string
}

export interface NavigationHost {
  openExternal(url: string): Promise<void>
  openMarkdownLink(basePath: string, href: string): Promise<void>
}

export function normalizeRenderPath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
  const segments: string[] = []

  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(part)
  }

  return segments.join('/')
}
