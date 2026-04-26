export type QuickEditTargetMode = 'document' | 'selection' | 'source-line' | 'scroll-ratio'

export interface QuickEditTarget {
  filePath: string
  tabId: string
  leafId?: string | null
  canonicalPath?: string
  targetText?: string
  targetLine?: number
  sourceLine?: number
  scrollRatio?: number
  mode: QuickEditTargetMode
}
