import type { Tab } from '../components/TabBar'
import type { RendererFileDiagnosticOperation } from './diagnostics'
import { readPreviewContentWithCache } from './fileCache'

type LinkedDocumentReader = (tab: Tab) => Promise<string>
let linkedDocumentReader: LinkedDocumentReader | undefined

export function registerLinkedDocumentReader(reader: LinkedDocumentReader): () => void {
  linkedDocumentReader = reader
  return () => { if (linkedDocumentReader === reader) linkedDocumentReader = undefined }
}

export function readTabPreviewContent(
  tab: Tab,
  forceRefresh = false,
  diagnosticOperation?: RendererFileDiagnosticOperation,
): Promise<string> {
  if (!tab.linkedReadOnly) return readPreviewContentWithCache(tab.file.path, forceRefresh, diagnosticOperation)
  if (!linkedDocumentReader) return Promise.reject(new Error('临时文件读取许可不可用，请从来源链接重新打开。'))
  return linkedDocumentReader(tab)
}
