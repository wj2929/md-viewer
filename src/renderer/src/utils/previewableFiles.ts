const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])
const EXCALIDRAW_EXTENSION = '.excalidraw'

function extensionOf(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(filePath))
}

export function isExcalidrawFile(filePath: string): boolean {
  return extensionOf(filePath) === EXCALIDRAW_EXTENSION
}

export function isPreviewableFile(filePath: string): boolean {
  return isMarkdownFile(filePath) || isExcalidrawFile(filePath)
}

export function buildExcalidrawPreviewMarkdown(source: string): string {
  const body = source.trimEnd()
  return `\`\`\`excalidraw\n${body}\n\`\`\`\n`
}

export function buildPreviewContentForFile(filePath: string, source: string): string {
  if (isExcalidrawFile(filePath)) {
    return buildExcalidrawPreviewMarkdown(source)
  }
  return source
}
