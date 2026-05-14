import type { DocumentViewMode } from '../../stores/documentViewModeStore'

interface DocumentModeSwitchProps {
  mode: DocumentViewMode
  dirty: boolean
  onChange: (mode: DocumentViewMode) => void
}

const OPTIONS: Array<{ mode: DocumentViewMode; label: string }> = [
  { mode: 'preview', label: '预览' },
  { mode: 'edit', label: '仅编辑' },
  { mode: 'compare', label: '对照预览' },
]

export function DocumentModeSwitch({ mode, dirty, onChange }: DocumentModeSwitchProps): JSX.Element {
  return (
    <div className="document-mode-switch" role="tablist" aria-label="文档视图模式">
      {OPTIONS.map(option => (
        <button
          key={option.mode}
          type="button"
          role="tab"
          aria-selected={mode === option.mode}
          className={mode === option.mode ? 'active' : ''}
          onClick={() => onChange(option.mode)}
        >
          {option.label}{dirty && option.mode === mode ? '*' : ''}
        </button>
      ))}
    </div>
  )
}
