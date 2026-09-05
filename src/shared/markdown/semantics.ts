export type MarkdownTargetKind =
  | 'markdown'
  | 'anchor'
  | 'external'
  | 'local-resource'
  | 'data'
  | 'unsupported'

export interface SplitMarkdownTarget {
  rawPath: string
  decodedPath: string
  rawQuery?: string
  query?: string
  rawAnchor?: string
  anchor?: string
}

export interface MarkdownInlineTokenLike {
  type: string
  content: string
}

export function extractPlainHeadingText(
  children: readonly MarkdownInlineTokenLike[] | null | undefined,
): string {
  return (children ?? [])
    .filter(child => child.type === 'text' || child.type === 'code_inline')
    .map(child => child.content)
    .join('')
    .trim()
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'heading'
}

export function createHeadingIdAllocator(): (text: string) => string {
  const usedIds = new Set<string>()
  return (text: string): string => {
    const baseSlug = slugifyHeading(text)
    let candidate = baseSlug
    let counter = 1
    while (usedIds.has(candidate)) {
      candidate = `${baseSlug}-${counter}`
      counter += 1
    }
    usedIds.add(candidate)
    return candidate
  }
}

export function uniqueHeadingSlug(
  text: string,
  usedSlugs: Map<string, number>,
): string {
  const baseSlug = slugifyHeading(text)
  let counter = usedSlugs.get(baseSlug) ?? 0
  let candidate = counter > 0 ? `${baseSlug}-${counter}` : baseSlug
  while (usedSlugs.has(candidate) && candidate !== baseSlug) {
    counter += 1
    candidate = `${baseSlug}-${counter}`
  }
  usedSlugs.set(baseSlug, counter + 1)
  usedSlugs.set(candidate, Math.max(usedSlugs.get(candidate) ?? 0, 1))
  return candidate
}

export function splitMarkdownTarget(target: string): SplitMarkdownTarget {
  const unwrapped = target.startsWith('<') && target.endsWith('>')
    ? target.slice(1, -1)
    : target
  const hashIndex = unwrapped.indexOf('#')
  const beforeHash = hashIndex >= 0 ? unwrapped.slice(0, hashIndex) : unwrapped
  const rawAnchor = hashIndex >= 0 ? unwrapped.slice(hashIndex + 1) : undefined
  const queryIndex = beforeHash.indexOf('?')
  const rawPath = (queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash).trim()
  const rawQuery = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : undefined
  const decodedPath = safeDecodeURIComponent(rawPath)
  const query = rawQuery === undefined ? undefined : safeDecodeURIComponent(rawQuery)
  const anchor = rawAnchor === undefined
    ? undefined
    : normalizeMarkdownAnchor(rawAnchor) || undefined

  return {
    rawPath,
    decodedPath,
    ...(rawQuery === undefined ? {} : { rawQuery, query }),
    ...(rawAnchor === undefined ? {} : { rawAnchor, anchor }),
  }
}

export function classifyMarkdownTarget(target: string): MarkdownTargetKind {
  const { decodedPath, anchor } = splitMarkdownTarget(target)
  if (!decodedPath && anchor) return 'anchor'
  if (/^data:/i.test(decodedPath)) return 'data'
  if (/^(?:https?:|mailto:)/i.test(decodedPath)) return 'external'
  if (/^(?:file:|javascript:|local-image:)/i.test(decodedPath)) return 'unsupported'
  if (/\.m(?:d|arkdown|down|kd|kdn|dx)$/i.test(decodedPath)) return 'markdown'
  return decodedPath ? 'local-resource' : 'unsupported'
}

export function normalizeMarkdownAnchor(anchor: string): string {
  return safeDecodeURIComponent(anchor.replace(/^#/, '')).trim()
}

export function normalizeAnchorForComparison(anchor: string): string {
  return normalizeMarkdownAnchor(anchor).replace(/[_-]/g, '').toLowerCase()
}

export function markdownAnchorMatches(actual: string, requested: string): boolean {
  const normalizedActual = normalizeMarkdownAnchor(actual)
  const normalizedRequested = normalizeMarkdownAnchor(requested)
  return normalizedActual === normalizedRequested || (
    normalizeAnchorForComparison(normalizedActual) === normalizeAnchorForComparison(normalizedRequested)
  )
}
