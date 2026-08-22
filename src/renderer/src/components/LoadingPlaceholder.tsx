/**
 * 懒加载 tab 内容读盘期间的占位。
 * 与预览区同色背景，居中 spinner + 文案，占满高度，避免白屏闪烁。
 */
export function LoadingPlaceholder(): JSX.Element {
  return (
    <div className="content-loading-placeholder" role="status" aria-live="polite">
      <span className="content-loading-spinner" aria-hidden="true" />
      <span className="content-loading-text">加载中…</span>
    </div>
  )
}
