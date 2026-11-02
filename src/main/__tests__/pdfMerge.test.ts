import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { mergePdfParts, validatePdfParts, type PdfPart } from '../pdf/pdfMerge'

const hash = 'a'.repeat(64)
const parts: PdfPart[] = [
  { start: 1, end: 2, pages: 2, file: 'part-1-2.pdf', sha256: hash },
  { start: 3, end: 4, pages: 2, file: 'part-3-4.pdf', sha256: hash },
]

async function segment(start: number, missingTarget = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setCreator('Chromium')
  doc.setProducer('Skia/PDF')
  doc.setAuthor('fixture')
  const pages = [doc.addPage([200 + start, 300]), doc.addPage([201 + start, 300])]
  const dests = doc.context.obj({})
  dests.set(PDFName.of(`page-${start}`), doc.context.obj([pages[0].ref, 'XYZ', 0, 200, null]))
  doc.catalog.set(PDFName.of('Dests'), doc.context.register(dests))
  for (const page of pages) {
    const annotations = [
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 20, 20], Dest: PDFName.of(missingTarget ? 'missing' : 'page-1') }),
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 0, 40, 20], A: { S: 'GoTo', D: PDFString.of('page-3') } }),
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 0, 60, 20], A: { S: 'URI', URI: PDFString.of('https://example.com/pdf') } }),
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 0, 80, 20], Dest: [page.ref, 'Fit'], P: page.ref }),
    ]
    page.node.set(PDFName.of('Annots'), doc.context.obj(annotations.map(annot => doc.context.register(annot))))
  }
  return doc.save()
}

describe('PDF segment merge', () => {
  it('rejects empty, overlapping, missing, fractional and inconsistent ranges', () => {
    expect(validatePdfParts(parts)).toBe(4)
    for (const invalid of [[], [parts[1]], [parts[0], parts[0]], [{ ...parts[0], pages: 1 }], [{ ...parts[0], start: 1.5 }], [{ ...parts[0], file: '../part-1-2.pdf' }]]) {
      expect(() => validatePdfParts(invalid)).toThrow()
    }
  })

  it('preserves page order/sizes, metadata, cross-segment names, GoTo, explicit destinations and URI', async () => {
    const data = [await segment(1), await segment(3)]
    const bytes = await mergePdfParts(parts, async part => data[part.start === 1 ? 0 : 1], '合并 & report')
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getPageCount()).toBe(4)
    expect(doc.getPages().map(page => page.getWidth())).toEqual([201, 202, 203, 204])
    expect(doc.getTitle()).toBe('合并 & report')
    expect(doc.getCreator()).toBe('Chromium')
    expect(doc.getProducer()).toBe('Skia/PDF')
    expect(doc.getAuthor()).toBe('fixture')
    const dests = doc.catalog.lookup(PDFName.of('Dests'), PDFDict)
    const pages = doc.getPages()
    expect(dests.lookup(PDFName.of('page-1'), PDFArray).get(0)).toBe(pages[0].ref)
    expect(dests.lookup(PDFName.of('page-3'), PDFArray).get(0)).toBe(pages[2].ref)
    for (const page of pages) {
      const annotations = page.node.Annots()!
      expect(annotations.size()).toBe(4)
      expect(annotations.lookup(0, PDFDict).get(PDFName.of('Dest'))).toBe(PDFName.of('page-1'))
      expect(annotations.lookup(1, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('D'), PDFString).decodeText()).toBe('page-3')
      expect(annotations.lookup(2, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.com/pdf')
      expect(annotations.lookup(3, PDFDict).lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(page.ref)
      expect(annotations.lookup(3, PDFDict).get(PDFName.of('P'))).toBe(page.ref)
    }
  })

  it('refuses missing destinations instead of silently dropping internal links', async () => {
    const first = await segment(1, true)
    const second = await segment(3)
    await expect(mergePdfParts(parts, async part => part.start === 1 ? first : second, 'report')).rejects.toThrow('目标无法恢复')
  })

  it('refuses unexpected source page counts and duplicate destination names', async () => {
    const first = await segment(1)
    await expect(mergePdfParts([{ ...parts[0], end: 1, pages: 1 }], async () => first, 'report')).rejects.toThrow('页数不一致')
    await expect(mergePdfParts(parts, async () => first, 'report')).rejects.toThrow('命名目标重复')
  })
})
