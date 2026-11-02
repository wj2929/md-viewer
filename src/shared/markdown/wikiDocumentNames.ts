import { classifyWikiResource, extensionOfResourcePath, LOCAL_ATTACHMENT_TEXT_EXTENSIONS, MARKDOWN_EXTENSIONS } from '../localMedia'

export function isBareWikiDocumentName(value: string): boolean {
  if (!value || value.length > 256 || value === '.' || value === '..' || /[\u0000-\u001f\u007f/\\#?|\[\]]/.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  const extension = extensionOfResourcePath(value)
  if (!extension) return true
  return classifyWikiResource(value) === 'attachment' && !LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(extension)
    && !MARKDOWN_EXTENSIONS.has(extension)
}
