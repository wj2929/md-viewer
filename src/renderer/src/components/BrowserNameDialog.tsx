import { useEffect, useRef, useState } from 'react'
import './MoveToDialog.css'

export function BrowserNameDialog({ title, location, initialName, onSubmit, onClose }: {
  title: string
  location: string
  initialName: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    const extension = initialName.lastIndexOf('.')
    input.current?.setSelectionRange(0, extension > 0 ? extension : initialName.length)
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <div className="move-to-overlay" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); onClose() }
    if (event.key === 'Tab') {
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
  }}>
    <form className="move-to-dialog browser-name-dialog" role="dialog" aria-modal="true" aria-labelledby="browser-name-title" onSubmit={event => {
      event.preventDefault()
      if (submitting.current || !name.trim()) return
      submitting.current = true; setBusy(true); setError('')
      void onSubmit(name).catch(cause => setError(cause instanceof Error ? cause.message : '操作失败，请重试')).finally(() => { submitting.current = false; setBusy(false) })
    }}>
      <div className="move-to-header"><h2 id="browser-name-title">{title}</h2></div>
      <div className="browser-name-body">
        <p title={location}>{location}</p>
        <label>名称<input ref={input} value={name} disabled={busy} onChange={event => setName(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        {error && <div role="alert" className="browser-action-error">{error}</div>}
      </div>
      <div className="move-to-footer"><span className="move-to-target">不会覆盖同名文件或文件夹</span><div className="move-to-actions">
        <button className="move-to-btn" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="move-to-btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? '处理中…' : '继续'}</button>
      </div></div>
    </form>
  </div>
}
