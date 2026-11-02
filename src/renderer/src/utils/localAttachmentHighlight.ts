import type { Extension } from '@codemirror/state'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export type AttachmentLanguage = 'json' | 'sql' | 'yaml' | 'xml'

const languages: Record<string, AttachmentLanguage> = {
  '.json': 'json', '.jsonl': 'json', '.ndjson': 'json',
  '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.html': 'xml', '.htm': 'xml', '.svg': 'xml',
}
const MAX_HIGHLIGHT_BYTES = 1024 * 1024
const MAX_HIGHLIGHT_LINES = 20_000
const MAX_HIGHLIGHT_LINE_LENGTH = 16 * 1024

export function attachmentLanguage(extension: string): AttachmentLanguage | undefined {
  return Object.hasOwn(languages, extension.toLowerCase()) ? languages[extension.toLowerCase()] : undefined
}

export function withinAttachmentHighlightBudget(content: string): boolean {
  if (content.length > MAX_HIGHLIGHT_BYTES || new TextEncoder().encode(content).length > MAX_HIGHLIGHT_BYTES) return false
  let lines = 1
  let length = 0
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++
      if (++lines > MAX_HIGHLIGHT_LINES) return false
      length = 0
    } else if (++length > MAX_HIGHLIGHT_LINE_LENGTH) return false
  }
  return true
}

const colors = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, class: 'attachment-token-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'attachment-token-string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'attachment-token-number' },
  { tag: [tags.propertyName, tags.attributeName], class: 'attachment-token-property' },
  { tag: [tags.tagName, tags.typeName, tags.standard(tags.variableName)], class: 'attachment-token-type' },
  { tag: [tags.comment, tags.meta], class: 'attachment-token-comment' },
]))

const pending = new Map<AttachmentLanguage, Promise<Extension>>()

export function loadAttachmentHighlight(language: AttachmentLanguage): Promise<Extension> {
  const cached = pending.get(language)
  if (cached) return cached
  const load = async (): Promise<Extension> => {
    switch (language) {
      case 'json': return [StreamLanguage.define({
        ...(await import('@codemirror/legacy-modes/mode/javascript')).json,
        tokenTable: { property: tags.propertyName },
      }), colors]
      case 'sql': return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/sql')).standardSQL), colors]
      case 'yaml': return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml), colors]
      case 'xml': return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/xml')).xml), colors]
    }
  }
  const result = load().catch(error => { pending.delete(language); throw error })
  pending.set(language, result)
  return result
}
