interface FilePreviewTooltipProps {
  visible: boolean
  content: string
  fileName: string
  position: { x: number; y: number }
}

export function FilePreviewTooltip({ visible, content, fileName, position }: FilePreviewTooltipProps): JSX.Element | null {
  if (!visible) return null

  return (
    <div
      className="file-preview-tooltip"
      role="tooltip"
      id="file-preview-tooltip"
      style={{ left: position.x, top: position.y }}
    >
      <div className="tooltip-filename">{fileName}</div>
      <div className={content === '无法预览此文件' ? 'tooltip-error' : 'tooltip-content'}>
        {content}
      </div>
    </div>
  )
}
