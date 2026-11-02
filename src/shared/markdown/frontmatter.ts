export const MAX_FRONTMATTER_LENGTH = 64 * 1024

export type FrontmatterEnvelope =
  | { status: 'none'; endOffset: 0 }
  | { status: 'invalid' | 'budget'; endOffset: number }
  | { status: 'valid'; contentStart: number; contentEnd: number; endOffset: number }

export function findFrontmatterEnvelope(source: string): FrontmatterEnvelope {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\r|\n|$)/.exec(source)
  if (!opening) return { status: 'none', endOffset: 0 }
  const contentStart = opening[0].length
  const bounded = source.slice(0, MAX_FRONTMATTER_LENGTH + 1)
  const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/gy
  lines.lastIndex = contentStart
  let match: RegExpExecArray | null
  while ((match = lines.exec(bounded)) && match[0].length > 0) {
    const line = match[0].replace(/[\r\n]+$/, '')
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line) && (lines.lastIndex < bounded.length || source.length === bounded.length)) {
      return { status: 'valid', contentStart, contentEnd: match.index, endOffset: lines.lastIndex }
    }
  }
  return { status: source.length > MAX_FRONTMATTER_LENGTH ? 'budget' : 'invalid', endOffset: source.length }
}
