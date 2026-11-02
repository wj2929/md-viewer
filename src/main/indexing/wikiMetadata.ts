import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import type { AnalyzedMarkdownLink } from '../../shared/markdown/analyze'
import { findFrontmatterEnvelope, MAX_FRONTMATTER_LENGTH } from '../../shared/markdown/frontmatter'
import { parseWikiReferenceAt } from '../../shared/markdown/obsidianSyntax'
import { isBareWikiDocumentName } from '../../shared/markdown/wikiDocumentNames'
import type { IndexedDocument } from './types'

export interface WikiMetadataView {
  documents: ReadonlyMap<string, IndexedDocument>
  metadata: ReadonlyMap<string, WikiDocumentMetadata>
  aliases: ReadonlyMap<string, ReadonlySet<string>>
  complete: boolean
}

export interface WorkspaceWikiSnapshot extends WikiMetadataView {
  rootPath: string
  epoch: number
  ready: boolean
  isCurrent: () => boolean
  isContinuous: () => boolean
}

export interface FrontmatterAliases {
  complete: boolean
  aliases: readonly string[]
  frontmatterEnd: number
  issue?: 'invalid' | 'budget' | 'unsupported'
}

export interface RuntimeWikiLink extends AnalyzedMarkdownLink {
  wikiEmbed?: boolean
}

export interface WikiDocumentMetadata extends FrontmatterAliases {
  revisionToken: string
  links: readonly RuntimeWikiLink[]
}

export function readFrontmatterAliases(source: string): FrontmatterAliases {
  const envelope = findFrontmatterEnvelope(source)
  if (envelope.status === 'none') return { complete: true, aliases: [], frontmatterEnd: 0 }
  const empty = { aliases: [], frontmatterEnd: envelope.endOffset }
  if (envelope.status !== 'valid') return { ...empty, complete: false, issue: envelope.status }
  const yaml = source.slice(envelope.contentStart, envelope.contentEnd)
  if (Buffer.byteLength(yaml, 'utf8') > MAX_FRONTMATTER_LENGTH) return { ...empty, complete: false, issue: 'budget' }
  try {
    const document = parseDocument(yaml.replace(/\r\n?/g, '\n'), { schema: 'core', uniqueKeys: true, strict: true, merge: false, prettyErrors: false, logLevel: 'silent' })
    if (document.errors.length) return { ...empty, complete: false, issue: 'invalid' }
    if (!isMap(document.contents) || document.contents.tag) return { ...empty, complete: true, issue: 'unsupported' }
    const pair = document.contents.items.find(item => isScalar(item.key) && item.key.value === 'aliases')
    if (!pair) return { ...empty, complete: true }
    const nodes = isSeq(pair.value) ? pair.value.items : [pair.value]
    if (nodes.length > 128) return { ...empty, complete: false, issue: 'budget' }
    if (nodes.some(node => !isScalar(node) || typeof node.value !== 'string'
      || (node.tag !== undefined && node.tag !== 'tag:yaml.org,2002:str'))) {
      return { ...empty, complete: true, issue: 'unsupported' }
    }
    const values = nodes.map(node => String((node as { value: string }).value).trim())
    if (values.some(value => value.length > 256)) return { ...empty, complete: false, issue: 'budget' }
    return { ...empty, complete: true, aliases: [...new Set(values.filter(isBareWikiDocumentName))] }
  } catch {
    return { ...empty, complete: false, issue: 'invalid' }
  }
}

export function createWikiDocumentMetadata(
  source: string,
  revisionToken: string,
  outboundLinks: readonly AnalyzedMarkdownLink[],
  includeAliases = true,
): WikiDocumentMetadata {
  const metadata: FrontmatterAliases = includeAliases ? readFrontmatterAliases(source) : {
    aliases: [], complete: true, frontmatterEnd: findFrontmatterEnvelope(source).endOffset,
  }
  const links: RuntimeWikiLink[] = outboundLinks
    .filter(link => link.sourceRange.startOffset >= metadata.frontmatterEnd)
    .map(link => {
      if (link.syntax !== 'wiki') return link
      const parsed = parseWikiReferenceAt(source, link.sourceRange.startOffset)
      if (!parsed || parsed.end !== link.sourceRange.endOffset || parsed.reference.rawTarget !== link.rawTarget) return link
      const wikiEmbed = parsed.reference.isEmbed
      return {
        ...link,
        wikiEmbed,
        kind: !wikiEmbed && isBareWikiDocumentName(parsed.reference.path) ? 'markdown' : link.kind,
      }
    })
  return { ...metadata, revisionToken, links }
}

export class WorkspaceWikiMetadata {
  epoch = 0
  dirty = true
  published: WikiMetadataView | undefined
  private readonly documents = new Map<string, WikiDocumentMetadata>()
  private aliasCount = 0
  private aliasBytes = 0

  invalidate(): void {
    this.epoch += 1
    this.dirty = true
  }

  reset(): void {
    this.invalidate()
    this.documents.clear()
    this.aliasCount = 0
    this.aliasBytes = 0
    this.published = undefined
  }

  remove(relativePath: string): void {
    const previous = this.documents.get(relativePath)
    if (previous) {
      this.aliasCount -= previous.aliases.length
      this.aliasBytes -= previous.aliases.reduce((bytes, alias) => bytes + Buffer.byteLength(alias, 'utf8'), 0)
      this.documents.delete(relativePath)
    }
  }

  set(relativePath: string, metadata: WikiDocumentMetadata): void {
    this.remove(relativePath)
    const bytes = metadata.aliases.reduce((size, alias) => size + Buffer.byteLength(alias, 'utf8'), 0)
    if (this.aliasCount + metadata.aliases.length > 100_000 || this.aliasBytes + bytes > 32 * 1024 * 1024) {
      this.documents.set(relativePath, { ...metadata, aliases: [], complete: false, issue: 'budget' })
      return
    }
    this.documents.set(relativePath, metadata)
    this.aliasCount += metadata.aliases.length
    this.aliasBytes += bytes
  }

  publish(documents: ReadonlyMap<string, IndexedDocument>, complete: boolean): void {
    for (const name of this.documents.keys()) if (!documents.has(name)) this.remove(name)
    const metadata = new Map(this.documents)
    const aliases = new Map<string, Set<string>>()
    for (const [relativePath, document] of documents) {
      const item = metadata.get(relativePath)
      if (!item || !item.complete || item.revisionToken !== document.revisionToken) {
        complete = false
        continue
      }
      for (const alias of item.aliases) {
        const matches = aliases.get(alias) ?? new Set<string>()
        matches.add(relativePath)
        aliases.set(alias, matches)
      }
    }
    this.published = { documents: new Map(documents), metadata, aliases, complete }
    this.dirty = false
  }
}
