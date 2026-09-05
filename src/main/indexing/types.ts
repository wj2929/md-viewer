import type { AnalyzedMarkdownHeading, AnalyzedMarkdownLink } from '../../shared/markdown/analyze'
import type { BacklinkPlacement } from '../../shared/markdown/backlinks'

export type WorkspaceIndexState = 'detached' | 'building' | 'ready' | 'updating' | 'degraded' | 'error' | 'read-only'

export interface IndexedDocument {
  schemaVersion: number
  rootKey: string
  indexInstanceId: string
  relativePath: string
  revisionToken: string
  mtimeMs: number
  size: number
  indexedAt: number
  headings: AnalyzedMarkdownHeading[]
  outboundLinks: AnalyzedMarkdownLink[]
  terms: Record<string, number>
  lineCount: number
}

export interface WorkspaceIndexManifest {
  schemaVersion: number
  rootKey: string
  rootFingerprint: string
  indexInstanceId: string
  generationId: string
  createdAt: number
  documents: Array<{
    relativePath: string
    revisionToken: string
    shardFile: string
  }>
}

export interface WorkspaceIndexStatus {
  state: WorkspaceIndexState
  generation: number
  indexedDocuments: number
  totalDocuments: number
  pendingDocuments: number
  errors: number
}

export interface WorkspaceSearchResult {
  relativePath: string
  displayName: string
  score: number
  headingId?: string
  lineStart: number
  snippet: string
  revisionToken: string
}

export interface WorkspaceHistorySearchResult extends WorkspaceSearchResult {
  historyId: string
  filePath: string
}

export interface WorkspaceBacklinkResult {
  sourceRelativePath: string
  sourceDisplayName: string
  lineStart: number
  rawTarget: string
  context: string
  placement: BacklinkPlacement
  sourceRange: import('../../shared/markdown/sourceLinks').SourceRange
}
