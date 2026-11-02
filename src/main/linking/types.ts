import type { SourceRange } from '../../shared/markdown/sourceLinks'

export interface LinkMoveMapping {
  oldRelativePath: string
  newRelativePath: string
}

export interface LinkImpactItem {
  sourceRelativePath: string
  lineStart: number
  rawTarget: string
  resolvedTargetRelativePath: string
  destinationRange?: SourceRange
  relation: 'inbound' | 'outbound'
  syntax?: 'wiki'
  provenance?: 'alias' | 'uncertain'
  confidence: 'exact' | 'candidate'
}

export interface LinkImpactSummary {
  impactId: string
  createdAt: number
  expiresAt: number
  mapping: LinkMoveMapping
  affectedSourceFiles: number
  exactChanges: number
  candidates: number
  items: LinkImpactItem[]
}

export interface LinkOperationReceipt {
  operationReceiptId: string
  impactId: string
  createdAt: number
  expiresAt: number
  mapping: LinkMoveMapping
  status: 'success'
}

export interface LinkMoveBatchOperation {
  impactId: string
  mapping: LinkMoveMapping
}

export interface LinkMoveBatchItemResult extends LinkMoveBatchOperation {
  status: 'success' | 'failed' | 'not-executed'
  newPath?: string
  receipt?: LinkOperationReceipt
  message?: string
}

export interface LinkMoveBatchResult {
  items: LinkMoveBatchItemResult[]
  warning?: string
}

export interface LinkRewriteChange {
  changeId: string
  sourceRelativePath: string
  lineStart: number
  sourceRevisionToken: string
  destinationRange: SourceRange
  before: string
  after: string
  reason: 'move' | 'rename'
  confidence: 'exact'
}

export interface LinkRewritePlanView {
  planId: string
  operationReceiptId: string
  createdAt: number
  expiresAt: number
  mapping: LinkMoveMapping
  changes: LinkRewriteChange[]
  warnings: string[]
}

export interface LinkRewriteApplyFileResult {
  sourceRelativePath: string
  status: 'updated' | 'conflict' | 'failed' | 'skipped'
  updatedChanges: number
  message?: string
}

export interface LinkRewriteApplyResult {
  planId: string
  files: LinkRewriteApplyFileResult[]
}

export interface LinkRewriteBatchApplyResult {
  planIds: string[]
  files: LinkRewriteApplyFileResult[]
}
