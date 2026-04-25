import { useRef, useCallback, type KeyboardEvent } from 'react'
import './DocxStyleCards.css'

type DocxStyle = 'standard' | 'official' | 'internal' | 'report'

interface DocxStyleCardsProps {
  value: DocxStyle
  onChange: (style: DocxStyle) => void
}

interface StyleDef {
  key: DocxStyle
  label: string
  desc: string
}

const STYLES: StyleDef[] = [
  { key: 'standard', label: '标准', desc: '日常文档、工作报告' },
  { key: 'official', label: '公文', desc: '政府机关公文（GB/T 9704）' },
  { key: 'internal', label: '机关内部', desc: '内部行文、通知' },
  { key: 'report', label: '调研报告', desc: '研究分析、学术报告' },
]

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
  standard: StandardSvg,
  official: OfficialSvg,
  internal: InternalSvg,
  report: ReportSvg,
}

export function DocxStyleCards({ value, onChange }: DocxStyleCardsProps): JSX.Element {
  const cardsRef = useRef<(HTMLLabelElement | null)[]>([])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLFieldSetElement>) => {
    const idx = STYLES.findIndex(s => s.key === value)
    let next = idx
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (idx + 1) % STYLES.length
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (idx - 1 + STYLES.length) % STYLES.length
      e.preventDefault()
    } else {
      return
    }
    onChange(STYLES[next].key)
    cardsRef.current[next]?.focus()
  }, [value, onChange])

  return (
    <fieldset className="docx-style-cards" role="radiogroup" aria-label="默认样式" onKeyDown={handleKeyDown}>
      {STYLES.map((style, i) => {
        const Svg = SVG_MAP[style.key]
        const isActive = value === style.key
        return (
          <label
            key={style.key}
            ref={el => { cardsRef.current[i] = el }}
            className={`docx-style-card${isActive ? ' active' : ''}`}
            tabIndex={isActive ? 0 : -1}
          >
            <input
              type="radio"
              name="docx-style"
              value={style.key}
              checked={isActive}
              onChange={() => onChange(style.key)}
              aria-checked={isActive}
            />
            <Svg />
            <div className="docx-style-card-label">{style.label}</div>
            <div className="docx-style-card-desc">{style.desc}</div>
          </label>
        )
      })}
    </fieldset>
  )
}
