import type { LinkOrigin } from '../utils/linkNavigation'

export function LinkOriginButton({ origin, className = '' }: { origin?: LinkOrigin; className?: string }) {
  if (!origin) return null
  const label = `返回来源：${origin.name}`
  return <button type="button" className={`link-origin-button ${className}`} title={origin.description ?? label}
    aria-label={label} aria-description={origin.description} disabled={origin.busy} onClick={event => { event.stopPropagation(); origin.onReturn() }}>
    <span aria-hidden="true">{origin.busy ? '…' : '←'}</span><span>{label}</span>
  </button>
}
