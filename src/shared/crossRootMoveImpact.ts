export interface CrossRootMoveMapping {
  sourceRelativePath: string
  destinationRelativePath: string
  isDirectory: boolean
}

export interface CrossRootImpactSection {
  markdownDocumentsScanned: number
  localMarkdownLinksExamined: number
  linksBreakingAfterMove: number
  linksResolvingAfterMove: number
  linksChangingResolution: number
}

export interface CrossRootMoveImpactReport {
  reportOnly: true
  origin: CrossRootImpactSection
  moved: CrossRootImpactSection
  target: CrossRootImpactSection
  coverage: {
    originIndexedMarkdownDocuments: number
    targetIndexedMarkdownDocuments: number
    ignoredLinks: number
    uncertainLinks: number
  }
}
