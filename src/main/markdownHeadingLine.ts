import MarkdownIt from 'markdown-it'
import {
  createHeadingIdAllocator,
  extractPlainHeadingText,
  markdownAnchorMatches,
} from '../shared/markdown/semantics'

const headingMarkdownParser = new MarkdownIt({ html: true, linkify: false })

export function findHeadingLine(markdown: string, headingId: string): number | undefined {
  const allocateHeadingId = createHeadingIdAllocator()
  const tokens = headingMarkdownParser.parse(markdown, {})
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inlineToken = tokens[index + 1]
    if (!inlineToken || inlineToken.type !== 'inline') continue
    const id = allocateHeadingId(extractPlainHeadingText(inlineToken.children))
    if (markdownAnchorMatches(id, headingId)) return token.map ? token.map[0] + 1 : undefined
  }
  return undefined
}
