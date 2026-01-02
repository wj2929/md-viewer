import { FileInfo } from './FileTree'

export interface Tab {
  id: string
  file: FileInfo
  content: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose }: TabBarProps): JSX.Element {
  if (tabs.length === 0) {
    return <div className="tabs" />
  }

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    onTabClose(tabId)
  }

  return (
    <div className="tabs">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onTabClick(tab.id)
            }
          }}
        >
          <span className="tab-icon">📄</span>
          <span className="tab-name" title={tab.file.path}>
            {tab.file.name}
          </span>
          <button
            className="tab-close"
            onClick={(e) => handleCloseClick(e, tab.id)}
            aria-label={`关闭 ${tab.file.name}`}
            title="关闭标签"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
