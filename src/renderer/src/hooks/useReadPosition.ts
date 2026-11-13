import { useEffect, useRef, type RefObject } from 'react'
import debounce from 'lodash.debounce'

type ReadPosition = { scrollRatio: number; headingId?: string }

export function useReadPosition({ rootRef, filePath, initialScrollRatio, isActive, renderVersion, onChange }: {
  rootRef: RefObject<HTMLDivElement | null>
  filePath?: string
  initialScrollRatio?: number
  isActive: boolean
  renderVersion: number
  onChange?: (position: ReadPosition) => void
}): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const hasOnChange = Boolean(onChange)
  const restoreRef = useRef({ filePath, ratio: initialScrollRatio, applied: false, interacted: false })
  if (restoreRef.current.filePath !== filePath) {
    restoreRef.current = { filePath, ratio: initialScrollRatio, applied: false, interacted: false }
  }

  useEffect(() => {
    if (!hasOnChange && !Number.isFinite(initialScrollRatio)) return
    const root = rootRef.current
    const container = (root?.closest('.preview') || root?.parentElement) as HTMLElement | null
    if (!root || !container) return
    const restore = restoreRef.current
    const hasInitialPosition = typeof restore.ratio === 'number' && Number.isFinite(restore.ratio)
    // 显式定位已取代初始恢复；之后清除定位请求也不能重新拉回旧位置。
    if (initialScrollRatio === undefined && hasInitialPosition) restore.interacted = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let resize: ResizeObserver | undefined
    const restoring = () => hasInitialPosition && !restore.interacted
    const measurable = () => !disposed && root.isConnected && container.clientHeight > 0
      && !root.closest('[hidden], [inert], [data-browser-layout-paused]')
    const cancelForLayout = (event: Event) => {
      if (event.target instanceof Node && (event.target as HTMLElement).contains(root)) report.cancel()
    }
    const report = debounce(() => {
      if (!measurable() || restoreRef.current !== restore || restoring()) return
      const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight)
      const containerTop = container.getBoundingClientRect().top
      const activeHeading = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
        .map(heading => ({ heading, top: heading.getBoundingClientRect().top - containerTop }))
        .filter(item => item.top <= container.clientHeight * 0.35)
        .sort((a, b) => b.top - a.top)[0]?.heading
      onChangeRef.current?.({ scrollRatio: Math.max(0, Math.min(1, container.scrollTop / maxScroll)),
        ...(activeHeading?.id ? { headingId: activeHeading.id } : {}) })
    }, 500)
    const scroll = () => { if (!restoring() && measurable()) report() }
    const interact = () => {
      restore.interacted = true
      if (timer !== undefined) clearTimeout(timer)
      resize?.disconnect()
    }
    const keydown = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      if (container.parentElement?.contains(event.target as Node) ||
          (isActive && (event.target === document.body || event.target === document.documentElement))) interact()
    }
    const apply = () => {
      if (!measurable() || restoreRef.current !== restore || !restoring()) return
      restore.applied = true
      report.cancel()
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      container.scrollTo({ top: maxScroll * Math.max(0, Math.min(1, restore.ratio!)), behavior: 'auto' })
    }
    const interactionRoot = container.parentElement ?? container
    interactionRoot.addEventListener('wheel', interact, { passive: true })
    interactionRoot.addEventListener('pointerdown', interact, { passive: true })
    document.addEventListener('keydown', keydown)
    document.addEventListener('browser-layout-start', cancelForLayout)
    container.addEventListener('scroll', scroll, { passive: true })
    if (restoring()) {
      if (!restore.applied) timer = setTimeout(apply, 300)
      // 图表/图片改变高度时维持初始比例；首次用户交互即停止跟随。
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(() => { if (restore.applied) apply() })
        resize.observe(root)
      }
    }
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      resize?.disconnect()
      report.cancel()
      container.removeEventListener('scroll', scroll)
      interactionRoot.removeEventListener('wheel', interact)
      interactionRoot.removeEventListener('pointerdown', interact)
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('browser-layout-start', cancelForLayout)
    }
  }, [rootRef, filePath, initialScrollRatio, isActive, renderVersion, hasOnChange])
}
