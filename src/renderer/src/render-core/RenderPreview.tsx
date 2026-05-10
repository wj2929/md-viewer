import { useMemo } from 'react'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../utils/markdownRenderer'
import type { ResourceHost } from './hosts'

export interface RenderPreviewProps {
  content: string
  markdownFilePath?: string
  resourceHost: ResourceHost
  className?: string
}

export function RenderPreview({ content, className = '' }: RenderPreviewProps): JSX.Element {
  const md = useMemo(() => {
    setupDOMPurifyHooks()
    return createMarkdownRenderer()
  }, [])

  const html = useMemo(() => sanitizeHtml(md.render(content)), [content, md])

  return (
    <div
      className={`markdown-body ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
