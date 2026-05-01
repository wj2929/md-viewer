import { useRef, useCallback, type KeyboardEvent } from 'react'
import './DocxStyleCards.css'
import { type DocxStyle } from '../../../shared/docxStyles'

interface DocxStyleCardsProps {
  value: DocxStyle
  onChange: (style: DocxStyle) => void
  disabledStyles?: DocxStyle[]
}

interface StyleDef {
  key: DocxStyle
  label: string
  desc: string
  badge?: string
}

const STYLES: StyleDef[] = [
  { key: 'preview', label: '预览一致', desc: '接近 Markdown 预览与 PDF 导出的页面节奏', badge: '推荐' },
  { key: 'standard', label: '通用 Word', desc: '适合后续编辑的常规 Word 排版' },
  { key: 'official', label: '正式公文', desc: '政府机关公文（GB/T 9704）' },
  { key: 'internal', label: '机关内部', desc: '内部行文、通知' },
  { key: 'report', label: '调研报告', desc: '研究分析、学术报告' },
]

function PreviewSvg(): JSX.Element {
  return (
    <svg className="docx-style-card-thumbnail" width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="0.5" y="0.5" width="79" height="55" rx="3" stroke="var(--border-color)" />
      <rect x="7" y="6" width="28" height="4" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="7" y="14" width="60" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="7" y="19" width="50" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="7" y="26" width="66" height="14" rx="1" fill="currentColor" opacity="0.08" />
      <rect x="11" y="30" width="12" height="2" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="28" y="30" width="15" height="2" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="48" y="30" width="17" height="2" rx="1" fill="currentColor" opacity="0.35" />
      <path d="M12 47C18 39 24 44 30 39C37 33 43 47 50 41C56 36 61 39 68 32" stroke="currentColor" strokeWidth="2" opacity="0.45" />
    </svg>
  )
}

function StandardSvg(): JSX.Element {
  return (
    <svg className="docx-style-card-thumbnail" width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="0.5" y="0.5" width="79" height="55" rx="3" stroke="var(--border-color)" />
      <rect x="8" y="8" width="24" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="8" y="16" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="8" y="22" width="40" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="8" y="28" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="8" y="34" width="36" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="8" y="40" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="8" y="46" width="44" height="2" rx="1" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

function OfficialSvg(): JSX.Element {
  return (
    <svg className="docx-style-card-thumbnail" width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="0.5" y="0.5" width="79" height="55" rx="3" stroke="var(--border-color)" />
      <rect x="20" y="8" width="40" height="5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="14" y="18" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="23" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="28" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="33" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="38" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="43" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="14" y="48" width="52" height="2" rx="1" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

function InternalSvg(): JSX.Element {
  return (
    <svg className="docx-style-card-thumbnail" width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="0.5" y="0.5" width="79" height="55" rx="3" stroke="var(--border-color)" />
      <rect x="22" y="8" width="36" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="12" y="17" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="23" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="29" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="35" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="41" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="47" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

function ReportSvg(): JSX.Element {
  return (
    <svg className="docx-style-card-thumbnail" width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="0.5" y="0.5" width="79" height="55" rx="3" stroke="var(--border-color)" />
      <rect x="26" y="8" width="28" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="12" y="16" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="21" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="26" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="31" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="36" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="41" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="12" y="46" width="56" height="2" rx="1" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

const SVG_MAP: Record<DocxStyle, () => JSX.Element> = {
  preview: PreviewSvg,
  standard: StandardSvg,
  official: OfficialSvg,
  internal: InternalSvg,
  report: ReportSvg,
}

export function DocxStyleCards({ value, onChange, disabledStyles = [] }: DocxStyleCardsProps): JSX.Element {
  const cardsRef = useRef<(HTMLLabelElement | null)[]>([])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLFieldSetElement>) => {
    const idx = STYLES.findIndex(s => s.key === value)
    let direction = 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      direction = 1
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      direction = -1
      e.preventDefault()
    } else {
      return
    }
    const disabled = new Set(disabledStyles)
    let next = idx
    for (let step = 1; step <= STYLES.length; step += 1) {
      const candidate = (idx + direction * step + STYLES.length) % STYLES.length
      if (!disabled.has(STYLES[candidate].key)) {
        next = candidate
        break
      }
    }
    onChange(STYLES[next].key)
    cardsRef.current[next]?.focus()
  }, [value, onChange, disabledStyles])

  return (
    <fieldset className="docx-style-cards" role="radiogroup" aria-label="默认样式" onKeyDown={handleKeyDown}>
      {STYLES.map((style, i) => {
        const Svg = SVG_MAP[style.key]
        const isActive = value === style.key
        const isDisabled = disabledStyles.includes(style.key)
        return (
          <label
            key={style.key}
            ref={el => { cardsRef.current[i] = el }}
            className={`docx-style-card${isActive ? ' active' : ''}${isDisabled ? ' disabled' : ''}`}
            tabIndex={isActive ? 0 : -1}
            aria-disabled={isDisabled}
          >
            <input
              type="radio"
              name="docx-style"
              value={style.key}
              checked={isActive}
              disabled={isDisabled}
              onChange={() => {
                if (!isDisabled) onChange(style.key)
              }}
              aria-checked={isActive}
            />
            <Svg />
            {style.badge && <div className="docx-style-card-badge">{style.badge}</div>}
            <div className="docx-style-card-label">{style.label}</div>
            <div className="docx-style-card-desc">{style.desc}</div>
          </label>
        )
      })}
    </fieldset>
  )
}
