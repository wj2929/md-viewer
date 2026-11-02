import type { WorkspaceOperationContext } from './workspace'
import type { LocalAttachmentResult, LocalResourceResolutionKind } from './localMedia'

export interface LinkedReadSource {
  filePath: string
  documentId?: string
}

export interface LinkedReadRequest {
  operation: WorkspaceOperationContext
  source: LinkedReadSource
  href: string
  leafId: string
  requestId: string
  resolutionKind?: LocalResourceResolutionKind
  rootOnly?: boolean // 旧嵌入与根内返回只限缩读取，不签发单文件例外。
}

export type LinkedReadErrorCode = 'invalid-reference' | 'unavailable' | 'stale'
  | 'too-large' | 'not-utf8' | 'binary' | 'explicit-path-required'
  | 'wiki-ambiguous' | 'alias-updating' | 'alias-incomplete' | 'wiki-resource'

export interface PreparedLinkedDocument {
  success: true
  targetPath: string
  content: string
  batchId: string
  documentId?: string
  access: 'root' | 'linked-readonly'
  targetLine?: number
  headingId?: string
  blockId?: string
}

export type LinkedDocumentResult = PreparedLinkedDocument | { success: false; code: LinkedReadErrorCode }
export type LinkedReadActionResult = { success: true } | { success: false; code: LinkedReadErrorCode }

export type LinkedAttachmentResult = LocalAttachmentResult & {
  resourceHandle?: string
  canViewAsText?: boolean
  systemOpenRef?: string
}

export const linkedReadErrorMessages: Record<LinkedReadErrorCode, string> = {
  'wiki-resource': '同名目标是本地附件，而不是 Markdown 文档。',
  'wiki-ambiguous': 'Wiki 名称对应多个文档，请使用明确文件路径。',
  'alias-updating': '别名索引正在更新，请稍后重试。',
  'alias-incomplete': '部分文档的别名无法确认，请使用文件路径打开。',
  'invalid-reference': '链接路径或编码无效。',
  unavailable: '文件不存在、不可读取或属于受保护路径。',
  stale: '来源或工作区已变化，请重新点击链接。',
  'too-large': '文件超过 5 MiB 读取上限。',
  'not-utf8': '文件不是有效 UTF-8 文本。',
  binary: '文件包含二进制内容，不能按文本查看。',
  'explicit-path-required': '此文档由外部链接打开，请使用明确文件路径，例如 ./目标.md。',
}
