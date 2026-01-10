/**
 * 目录提取模块
 * 基于 markdown-it Token 流提取目录结构
 */

import type Token from 'markdown-it/lib/token.mjs'
import { uniqueSlugify } from './slugify'

/**
 * 目录项结构
 */
export interface TocItem {
  /** 标题 ID（用于跳转） */
  id: string
  /** 标题文本 */
  text: string
  /** 标题级别 (1-6) */
  level: number
}

/**
 * 从 markdown-it Token 流中提取目录
 * 优点：与渲染结果 100% 一致，自动处理代码块等边界情况
 *
 * @param tokens - markdown-it 解析后的 Token 数组
 * @returns 目录项数组
 */
export function extractTocFromTokens(tokens: Token[]): TocItem[] {
  const toc: TocItem[] = []
  const usedSlugs = new Map<string, number>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1)) // h1 -> 1
      const inlineToken = tokens[i + 1]

      if (!inlineToken || inlineToken.type !== 'inline') continue

      // 提取纯文本内容（排除 Markdown 语法）
      const text = inlineToken.children
        ?.filter((t: Token) => t.type === 'text' || t.type === 'code_inline')
        .map((t: Token) => t.content)
        .join('')
        .trim() || ''

      if (!text) continue

      const id = uniqueSlugify(text, usedSlugs)
      toc.push({ id, text, level })
    }
  }

  return toc
}

/**
 * 从 Markdown 字符串直接提取目录
 *
 * @param markdown - Markdown 源文本
 * @param md - markdown-it 实例
 * @returns 目录项数组
 */
export function extractToc(
  markdown: string,
  md: { parse: (src: string, env: object) => Token[] }
): TocItem[] {
  if (!markdown) return []
  const tokens = md.parse(markdown, {})
  return extractTocFromTokens(tokens)
}
