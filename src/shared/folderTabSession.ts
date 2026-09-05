export interface FolderSplitLeafViewState {
  scrollRatio?: number
  headingId?: string
  contentHash?: string
}

export type PersistedFolderSplitNode =
  | {
      type: 'leaf'
      relativePath: string
      viewState?: FolderSplitLeafViewState
    }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number
      first: PersistedFolderSplitNode
      second: PersistedFolderSplitNode
    }

export interface FolderSplitLayoutV1 {
  version: 1
  root: PersistedFolderSplitNode | null
  activeLeafPath: number[] | null
}
