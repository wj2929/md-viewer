import path from 'node:path'
import { MARKDOWN_EXTENSIONS } from '../../shared/localMedia'
import { findWikiDocumentFile } from '../localResourceResolver'
import type { WorkspaceWikiSnapshot } from './wikiMetadata'

export type WikiNameResolution =
  | { status: 'found'; target: string; provenance: 'file' | 'alias' }
  | { status: 'missing' | 'ambiguous' | 'uncertain' | 'blocked' }

export function createWikiNameLookup(root: string, snapshot: WorkspaceWikiSnapshot | null) {
  const cache = new Map<string, Promise<WikiNameResolution>>()
  const deadline = performance.now() + 5000
  return (source: string, name: string): Promise<WikiNameResolution> => {
    if (snapshot && !snapshot.isCurrent()) return Promise.resolve({ status: 'uncertain' })
    const key = JSON.stringify([path.posix.dirname(source), name])
    const cached = cache.get(key)
    if (cached) return cached
    if (cache.size >= 256 || performance.now() > deadline) return Promise.resolve({ status: 'uncertain' })
    const pending = (async (): Promise<WikiNameResolution> => {
      const file = await findWikiDocumentFile(root, path.join(root, source), name)
      if (snapshot && !snapshot.isCurrent()) return { status: 'uncertain' }
      if (file.status === 'found') {
        if (!MARKDOWN_EXTENSIONS.has(path.extname(file.candidatePath ?? file.canonicalPath).toLowerCase())
          || !MARKDOWN_EXTENSIONS.has(path.extname(file.canonicalPath).toLowerCase())) return { status: 'blocked' }
        return { status: 'found', target: path.relative(root, file.canonicalPath).split(path.sep).join('/'), provenance: 'file' }
      }
      if (file.status === 'ambiguous') return { status: 'ambiguous' }
      if (file.status !== 'missing' || !snapshot?.ready) return { status: 'uncertain' }
      const matches = snapshot.aliases.get(name)
      if (!matches?.size) return { status: 'missing' }
      if (matches.size !== 1) return { status: 'ambiguous' }
      return { status: 'found', target: [...matches][0], provenance: 'alias' }
    })()
    cache.set(key, pending)
    return pending
  }
}
