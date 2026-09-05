interface MissingFilePlaceholderProps {
  candidatePath?: string
  onRetry: () => void
  onUseCandidate?: () => void
  onClose: () => void
}

export function MissingFilePlaceholder({
  candidatePath,
  onRetry,
  onUseCandidate,
  onClose,
}: MissingFilePlaceholderProps): JSX.Element {
  return (
    <div className="missing-file-placeholder" role="status">
      <strong>文件已被删除或暂时不可访问</strong>
      {candidatePath && (
        <p>检测到可能的新位置：{candidatePath.split(/[/\\]/).pop() || candidatePath}</p>
      )}
      <div className="missing-file-actions">
        <button type="button" onClick={onRetry}>重试</button>
        {candidatePath && onUseCandidate && (
          <button type="button" onClick={onUseCandidate}>使用可能的新位置</button>
        )}
        <button type="button" onClick={onClose}>关闭标签</button>
      </div>
    </div>
  )
}
