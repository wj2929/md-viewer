import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { findFrontmatterEnvelope } from './frontmatter'
import { installMathRules } from './mathRules'

export const BLOCK_ID_PATTERN = /^[A-Za-z0-9-]+$/
export const BLOCK_ANCHOR_PREFIX = 'md-block:'

export interface MarkdownBlock {
  id: string
  startOffset: number
  endOffset: number
  owner: Token
}
interface BlockNode {
  token: Token
  parent?: BlockNode
  children: BlockNode[]
}

const parser = new MarkdownIt({ html: true })
installMathRules(parser)

export function collectMarkdownBlocks(source: string, tokens: Token[]): MarkdownBlock[] {
  const starts = [0]
  const lineBreak = /\r\n|\r|\n/g
  let match: RegExpExecArray | null
  while ((match = lineBreak.exec(source))) starts.push(match.index + match[0].length)
  const frontmatterEnd = findFrontmatterEnvelope(source).endOffset
  const roots: BlockNode[] = []
  const stack: BlockNode[] = []
  for (const token of tokens) {
    if (token.nesting === -1) { stack.pop(); continue }
    const parent = stack.at(-1)
    const node: BlockNode = { token, parent, children: [] }
    ;(parent?.children ?? roots).push(node)
    if (token.nesting === 1) stack.push(node)
  }
  const result: MarkdownBlock[] = []
  const eligible = (node: BlockNode | undefined): node is BlockNode => Boolean(node &&
    ['paragraph_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open'].includes(node.token.type))
  const visit = (nodes: BlockNode[]) => {
    let previous: BlockNode | undefined
    for (const node of nodes) {
      const { token } = node
      const inline = node.children.find(child => child.token.type === 'inline')?.token
      let standalone = false
      if (token.type === 'paragraph_open' && token.map && inline) {
        const marker = /(?:^|\s)\^([A-Za-z0-9-]+)$/.exec(inline.content.trimEnd())
        const last = inline.children?.at(-1)
        const rawEnd = starts[token.map[1]] ?? source.length
        const rawLine = source.slice(starts[token.map[1] - 1], rawEnd).replace(/[\r\n]+$/, '').trimEnd()
        if (marker && last?.type === 'text' && last.content.endsWith(`^${marker[1]}`)
          && /(?:^|\s)\^[A-Za-z0-9-]+$/.test(rawLine)) {
          standalone = inline.content.trim() === `^${marker[1]}`
          let owner: BlockNode | undefined = node
          if (standalone) owner = eligible(previous) ? previous : undefined
          else {
            for (let parent = node.parent; parent; parent = parent.parent) {
              if (parent.token.type === 'list_item_open') { owner = parent; break }
            }
          }
          if (owner?.token.map && starts[token.map[0]] >= frontmatterEnd
            && starts[owner.token.map[0]] >= frontmatterEnd) {
            result.push({ id: marker[1], startOffset: starts[owner.token.map[0]],
              endOffset: starts[owner.token.map[1]] ?? source.length, owner: owner.token })
          }
        }
      }
      visit(node.children)
      previous = standalone ? undefined : node
    }
  }
  visit(roots)
  return result
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  return collectMarkdownBlocks(source, parser.parse(source, {}))
}

export function inspectMarkdownBlock(source: string, id: string): 'found' | 'missing' | 'ambiguous' {
  if (!BLOCK_ID_PATTERN.test(id)) return 'missing'
  const matches = parseMarkdownBlocks(source).filter(block => block.id === id)
  return matches.length === 1 ? 'found' : matches.length ? 'ambiguous' : 'missing'
}
