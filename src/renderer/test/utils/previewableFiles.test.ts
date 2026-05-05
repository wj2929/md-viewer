import { describe, expect, it } from 'vitest'
import {
  buildPreviewContentForFile,
  isExcalidrawFile,
  isMarkdownFile,
  isPreviewableFile,
} from '../../src/utils/previewableFiles'

describe('previewableFiles', () => {
  it('keeps Markdown content unchanged', () => {
    const markdown = '# 标题\n\n正文'

    expect(buildPreviewContentForFile('/docs/readme.md', markdown)).toBe(markdown)
  })

  it('wraps direct .excalidraw JSON as a readonly Excalidraw code block', () => {
    const source = '{\n  "type": "excalidraw",\n  "elements": []\n}\n'

    expect(buildPreviewContentForFile('/docs/diagram.excalidraw', source)).toBe(
      '```excalidraw\n{\n  "type": "excalidraw",\n  "elements": []\n}\n```\n'
    )
  })

  it('classifies supported preview file extensions', () => {
    expect(isMarkdownFile('/docs/a.MD')).toBe(true)
    expect(isMarkdownFile('/docs/a.markdown')).toBe(true)
    expect(isExcalidrawFile('/docs/a.excalidraw')).toBe(true)
    expect(isPreviewableFile('/docs/a.excalidraw')).toBe(true)
    expect(isPreviewableFile('/docs/a.txt')).toBe(false)
  })
})
