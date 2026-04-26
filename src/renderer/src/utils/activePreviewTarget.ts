import type { Tab } from '../components/TabBar'
import type { SplitState } from './splitTree'
import { findLeaf } from './splitTree'

export interface ActivePreviewTarget {
  tab: Tab
  tabId: string
  filePath: string
  fileName: string
  leafId: string | null
}

export function resolveActivePreviewTarget(
  tabs: Tab[],
  activeTabId: string | null,
  splitState: SplitState
): ActivePreviewTarget | null {
  const activeLeaf = splitState.root && splitState.activeLeafId
    ? findLeaf(splitState.root, splitState.activeLeafId)
    : null

  const tabId = activeLeaf?.tabId || activeTabId
  if (!tabId) return null

  const tab = tabs.find(item => item.id === tabId)
  if (!tab) return null

  return {
    tab,
    tabId: tab.id,
    filePath: tab.file.path,
    fileName: tab.file.name,
    leafId: activeLeaf?.id || null,
  }
}
