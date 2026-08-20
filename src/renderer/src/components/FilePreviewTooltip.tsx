import { DOCUMENT_MARK_COLORS, type DocumentMarkColor } from '../../../shared/documentMarks'

interface FilePreviewTooltipProps {
  visible: boolean
  content: string
  fileName: string
  filePath: string
  position: { x: number; y: number }
  markColor?: DocumentMarkColor
  onMarkChange?: (filePath: string, color: DocumentMarkColor | null) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const MARK_LABELS: Record<DocumentMarkColor, string> = {
  red: '红色',
  green: '绿色',
  yellow: '黄色',
  blue: '蓝色',
  cyan: '青色',
  purple: '紫色',
}

export function FilePreviewTooltip({
  visible,
  content,
  fileName,
  filePath,
  position,
  markColor,
  onMarkChange,
  onMouseEnter,
  onMouseLeave,
}: FilePreviewTooltipProps): JSX.Element | null {
  if (!visible) return null
  const options: Array<DocumentMarkColor | null> = [null, ...DOCUMENT_MARK_COLORS]

  return (
    <div
      className="file-preview-tooltip"
      role="dialog"
      aria-label={`${fileName}预览与背景标记`}
      id="file-preview-tooltip"
      style={{ left: position.x, top: position.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="tooltip-filename">{fileName}</div>
      <div className={content === '无法预览此文件' ? 'tooltip-error' : 'tooltip-content'}>
        {content}
      </div>
      {onMarkChange && (
        <div className="tooltip-mark-controls">
          <span>背景标记</span>
          <div className="tooltip-mark-options" role="radiogroup" aria-label="设置文档背景标记色">
            {options.map((color) => {
              const label = color ? MARK_LABELS[color] : '取消背景标记'
              const checked = color === (markColor ?? null)
              return (
                <button
                  key={color ?? 'none'}
                  type="button"
                  role="radio"
                  aria-label={label}
                  aria-checked={checked}
                  title={label}
                  className={`document-mark-option ${color ? `mark-${color}` : 'mark-none'} ${checked ? 'active' : ''}`}
                  onClick={() => onMarkChange(filePath, color)}
                >
                  {color ? <span aria-hidden="true" /> : <span aria-hidden="true">⊘</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
