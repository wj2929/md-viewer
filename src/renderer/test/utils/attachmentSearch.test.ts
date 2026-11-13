import { describe, expect, it } from 'vitest'
import { findAttachmentMatch, type AttachmentSearchRequest } from '../../src/utils/attachmentSearch'

const request = (content: string, search: string, extra: Partial<AttachmentSearchRequest> = {}): AttachmentSearchRequest => ({
  content, from: 0, to: 0, backward: false,
  query: { search, caseSensitive: false, literal: false, regexp: false, wholeWord: false },
  ...extra,
})

describe('attachment search worker operation', () => {
  it('finds the end of a complete 5 MiB document without truncation', () => {
    const content = 'a'.repeat(5 * 1024 * 1024) + ' NEEDLE'
    expect(findAttachmentMatch(request(content, 'needle'))).toEqual({ from: content.length - 6, to: content.length })
  })

  it('preserves Unicode normalization and UTF-16 selection offsets', () => {
    expect(findAttachmentMatch(request('🙂 café ﬁle', 'café'))).toEqual({ from: 3, to: 7 })
    expect(findAttachmentMatch(request('🙂 café ﬁle', 'file'))).toEqual({ from: 8, to: 11 })
  })

  it.each([false, true])('retains a valid zero-width regexp match, backward=%s', backward => {
    const base = request('fixture', '^', { backward })
    expect(findAttachmentMatch({ ...base, query: { ...base.query, regexp: true } })).toEqual({ from: 0, to: 0 })
  })

  it('keeps syntax-specific whole-word characters without sending executable language extensions', () => {
    const base = request('$foo foo', 'foo', { wordChars: '$' })
    expect(findAttachmentMatch({ ...base, query: { ...base.query, wholeWord: true } })).toEqual({ from: 5, to: 8 })
  })

  it('wraps in both directions and skips the current selection', () => {
    expect(findAttachmentMatch(request('one one one', 'one', { from: 8, to: 11 }))).toEqual({ from: 0, to: 3 })
    expect(findAttachmentMatch(request('one one one', 'one', { from: 0, to: 3, backward: true }))).toEqual({ from: 8, to: 11 })
    expect(findAttachmentMatch(request('one one one', 'one', { from: 8, to: 11, backward: true }))).toEqual({ from: 4, to: 7 })
  })

  it('keeps CodeMirror forward-overlap and backward non-overlap behavior', () => {
    expect(findAttachmentMatch(request('aaa', 'aa', { from: 1, to: 3 }))).toEqual({ from: 0, to: 2 })
    expect(findAttachmentMatch(request('aaa', 'aa', { from: 1, to: 3, backward: true }))).toBeNull()
  })

  it('keeps case, regular expression, whole-word and escaped-newline options', () => {
    const base = request('xFOO Foo food\nbar', 'Foo')
    expect(findAttachmentMatch({ ...base, query: { ...base.query, caseSensitive: true, wholeWord: true } })).toEqual({ from: 5, to: 8 })
    expect(findAttachmentMatch({ ...base, query: { ...base.query, search: 'fo+\\w', regexp: true, wholeWord: true } })).toEqual({ from: 5, to: 8 })
    expect(findAttachmentMatch(request('first\nsecond', 'first\\nsecond'))).toEqual({ from: 0, to: 12 })
    expect(findAttachmentMatch({ ...base, query: { ...base.query, search: '[', regexp: true } })).toBeNull()
    expect(findAttachmentMatch(request('complete', 'absent'))).toBeNull()
  })
})
