import { EditorState } from '@codemirror/state'
import { SearchCursor, SearchQuery } from '@codemirror/search'

export interface AttachmentSearchRequest {
  content: string
  query: { search: string; caseSensitive: boolean; literal: boolean; regexp: boolean; wholeWord: boolean }
  from: number
  to: number
  backward: boolean
  wordChars?: string
}

export function findAttachmentMatch(request: AttachmentSearchRequest): { from: number; to: number } | null {
  const state = EditorState.create({
    doc: request.content,
    extensions: request.wordChars ? EditorState.languageData.of(() => [{ wordChars: request.wordChars }]) : [],
  })
  const query = new SearchQuery(request.query)
  if (!query.valid) return null
  const scan = (from: number, to: number, last = false) => {
    const cursor = query.getCursor(state, from, to)
    let match: { from: number; to: number } | null = null
    for (;;) {
      const step = cursor instanceof SearchCursor ? cursor.nextOverlapping() : cursor.next()
      if (step.done) return match
      if (!query.regexp && step.value.from === request.from && step.value.to === request.to) continue
      match = { from: step.value.from, to: step.value.to }
      if (!last) return match
    }
  }
  const text = query.literal ? query.search : query.search.replace(/\\([nrt\\])/g, (_, char: string) => char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : '\\')
  const overlap = query.regexp ? 0 : text.length
  return request.backward
    ? scan(0, request.from, true) || scan(Math.max(0, request.to - overlap), state.doc.length, true)
    : scan(request.to, state.doc.length) || scan(0, Math.min(state.doc.length, request.from + overlap))
}
