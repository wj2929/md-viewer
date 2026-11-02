import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib'

export interface PdfPart {
  start: number
  end: number
  pages: number
  file: string
  sha256: string
}

export function validatePdfParts(parts: readonly PdfPart[]): number {
  let next = 1
  for (const part of parts) {
    if (!Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) ||
        !Number.isSafeInteger(part.pages) || part.start !== next || part.pages < 1 ||
        part.end !== part.start + part.pages - 1 ||
        !/^part-\d+-\d+\.pdf$/.test(part.file) || !/^[a-f0-9]{64}$/.test(part.sha256)) {
      throw new Error('PDF 页段不连续或记录无效')
    }
    next = part.end + 1
  }
  if (next === 1) throw new Error('PDF 没有可合并的页面')
  return next - 1
}

function destinationName(value: PDFObject): string | undefined {
  if (value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText()
  }
  return undefined
}

/** 只合并本程序/当前 Chromium 生成的页段，不是通用 PDF 修复器。 */
export async function mergePdfParts(
  parts: readonly PdfPart[],
  readPart: (part: PdfPart) => Promise<Uint8Array>,
  title: string,
): Promise<Uint8Array> {
  const expectedPages = validatePdfParts(parts)
  const output = await PDFDocument.create()
  const destinations = PDFDict.withContext(output.context)
  const referencedNames = new Set<string>()

  for (const part of parts) {
    const source = await PDFDocument.load(await readPart(part), { updateMetadata: false })
    if (source.getPageCount() !== part.pages) throw new Error('PDF 页段页数不一致')
    // 当前打印未开启 outline；不能在出现未知文档级跳转结构时默默丢掉它。
    if (source.catalog.has(PDFName.of('Outlines')) ||
        source.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.has(PDFName.of('Dests'))) {
      throw new Error('PDF 包含尚未验证的文档级跳转结构')
    }
    if (part.start === 1) {
      output.setCreator(source.getCreator() ?? 'MD Viewer')
      output.setProducer(source.getProducer() ?? 'MD Viewer')
      const author = source.getAuthor()
      const subject = source.getSubject()
      const keywords = source.getKeywords()
      const created = source.getCreationDate()
      const modified = source.getModificationDate()
      if (author) output.setAuthor(author)
      if (subject) output.setSubject(subject)
      if (keywords) output.setKeywords([keywords])
      if (created) output.setCreationDate(created)
      if (modified) output.setModificationDate(modified)
    }
    const sourcePages = source.getPages()
    const copiedPages = await output.copyPages(source, source.getPageIndices())
    copiedPages.forEach(page => output.addPage(page))
    const pageRefs = new Map(sourcePages.map((page, i) => [page.ref.toString(), copiedPages[i].ref]))

    const remapDestination = (raw: PDFObject): PDFObject => {
      const value = source.context.lookup(raw)
      if (!value) throw new Error('PDF 跳转目标缺失')
      const name = destinationName(value)
      if (name !== undefined) {
        referencedNames.add(name)
        return value.clone(output.context)
      }
      const array = value instanceof PDFDict ? value.lookup(PDFName.of('D'), PDFArray) : value
      if (!(array instanceof PDFArray)) throw new Error('PDF 跳转结构不受支持')
      const page = array.get(0)
      const target = page instanceof PDFRef ? pageRefs.get(page.toString()) : undefined
      if (!target) throw new Error('PDF 跳转的页面引用无效')
      const mapped = PDFArray.withContext(output.context)
      mapped.push(target)
      for (const rawCoordinate of array.asArray().slice(1)) {
        const coordinate = source.context.lookup(rawCoordinate)
        if (!(coordinate instanceof PDFName) && !(coordinate instanceof PDFNumber) && coordinate !== PDFNull) {
          throw new Error('PDF 跳转坐标不受支持')
        }
        mapped.push(coordinate.clone(output.context))
      }
      return mapped
    }

    const sourceDests = source.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)
    for (const [name, value] of sourceDests?.entries() ?? []) {
      if (destinations.has(name)) throw new Error('PDF 命名目标重复')
      destinations.set(name, remapDestination(value))
    }

    for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
      const original = sourcePages[pageIndex].node.Annots()
      const copied = copiedPages[pageIndex].node.Annots()
      if ((original?.size() ?? 0) !== (copied?.size() ?? 0)) throw new Error('PDF 链接注释数量不一致')
      for (let i = 0; i < (original?.size() ?? 0); i++) {
        const before = original!.lookup(i, PDFDict)
        const after = copied!.lookup(i, PDFDict)
        const dest = before.get(PDFName.of('Dest'))
        if (dest) after.set(PDFName.of('Dest'), remapDestination(dest))
        const action = before.lookupMaybe(PDFName.of('A'), PDFDict)
        if (action?.get(PDFName.of('S')) === PDFName.of('GoTo')) {
          const target = action.get(PDFName.of('D'))
          if (!target) throw new Error('PDF 内部链接没有目标')
          after.lookup(PDFName.of('A'), PDFDict).set(PDFName.of('D'), remapDestination(target))
        }
        if (before.has(PDFName.of('P'))) after.set(PDFName.of('P'), copiedPages[pageIndex].ref)
      }
    }
  }

  const names = new Set(destinations.keys().map(name => name.decodeText()))
  if ([...referencedNames].some(name => !names.has(name))) throw new Error('PDF 内部链接目标无法恢复')
  if (destinations.keys().length) output.catalog.set(PDFName.of('Dests'), output.context.register(destinations))
  if (output.getPageCount() !== expectedPages) throw new Error('PDF 合并页数不一致')
  output.setTitle(title)
  const bytes = await output.save()
  const verified = await PDFDocument.load(bytes)
  if (verified.getPageCount() !== expectedPages) throw new Error('PDF 成品页数校验失败')
  return bytes
}
