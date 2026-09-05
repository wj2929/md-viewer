import { describe, expect, it } from 'vitest'
import {
  processRestrictedSvgInHtml,
  renderRestrictedSvgToSvg,
} from '../../src/utils/restrictedSvgRenderer'

const completeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="820" viewBox="0 0 1300 820" role="img" aria-labelledby="title desc">
  <title id="title">辽宁大连线补能示意</title>
  <desc id="desc">包含渐变、箭头、裁剪、复用和阴影的静态 SVG</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fafc" />
      <stop offset="1" stop-color="#dbeafe" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#172033" flood-opacity=".16" />
    </filter>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#3974c6" />
    </marker>
    <clipPath id="cardClip"><rect x="0" y="0" width="260" height="100" rx="16" /></clipPath>
    <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#94a3b8" />
    </pattern>
    <symbol id="badge" viewBox="0 0 60 24"><rect width="60" height="24" rx="12" fill="#d5e8d4" /></symbol>
    <style>
      .title { font: 700 29px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; fill: #172033; }
      text.caption { font-size: 16; font-weight: 600; fill: #334155; }
      .route { fill: none; stroke: #3974c6; stroke-width: 4; stroke-linecap: round; }
    </style>
  </defs>
  <rect width="1300" height="820" fill="url(#bg)" />
  <rect x="80" y="120" width="500" height="260" rx="20" fill="url(#dots)" filter="url(#shadow)" />
  <g clip-path="url(#cardClip)" transform="translate(100 150)">
    <text class="title" x="20" y="42">辽宁大连线</text>
    <text class="caption" x="20" y="76">中文与 system fonts</text>
  </g>
  <path class="route" d="M 200 500 C 420 380, 690 620, 980 470" marker-end="url(#arrow)" />
  <use href="#badge" x="1030" y="450" width="120" height="48" />
  <svg x="900" y="620" width="260" height="120" viewBox="0 0 260 120">
    <ellipse cx="130" cy="60" rx="110" ry="42" fill="#e1d5e7" />
    <text x="130" y="66" text-anchor="middle" font-size="18">嵌套 SVG</text>
  </svg>
</svg>`

function expectFailure(source: string, code: string): void {
  const result = renderRestrictedSvgToSvg(source, 'attack')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.code).toBe(code)
}

describe('restrictedSvgRenderer', () => {
  it('renders the supported static SVG profile and lowers simple class CSS', () => {
    const result = renderRestrictedSvgToSvg(completeSvg, 'trip-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).toContain('<svg')
    expect(result.svg).toContain('辽宁大连线')
    expect(result.svg).toContain('font-size="29"')
    expect(result.svg).toContain('font-weight="700"')
    expect(result.svg).toContain('font-family="-apple-system, BlinkMacSystemFont, &quot;PingFang SC&quot;, sans-serif"')
    expect(result.svg).toContain('<feDropShadow')
    expect(result.svg).not.toContain('<style')
    expect(result.svg).not.toContain('class=')
  })

  it('namespaces ids and all local references consistently', () => {
    const result = renderRestrictedSvgToSvg(completeSvg, 'trip-2')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).toContain('id="mdv-svg-trip-2-bg"')
    expect(result.svg).toContain('fill="url(#mdv-svg-trip-2-bg)"')
    expect(result.svg).toContain('href="#mdv-svg-trip-2-badge"')
    expect(result.svg).toContain('aria-labelledby="mdv-svg-trip-2-title mdv-svg-trip-2-desc"')
    expect(result.svg).not.toContain('url(#bg)')
  })

  it('rejects active, embedded and external content instead of silently stripping it', () => {
    const samples = [
      '<script>alert(1)</script>',
      '<foreignObject><div>HTML</div></foreignObject>',
      '<image href="https://example.com/a.png" />',
      '<animate attributeName="x" values="0;1" />',
    ]
    for (const payload of samples) {
      expectFailure(`<svg viewBox="0 0 100 100">${payload}</svg>`, 'SVG_UNSUPPORTED_ELEMENT')
    }
    expectFailure('<svg viewBox="0 0 100 100"><rect width="10" height="10" onclick="alert(1)" /></svg>', 'SVG_UNSAFE_ATTRIBUTE')
    expectFailure('<svg viewBox="0 0 100 100"><rect width="10" height="10" style="fill:red" /></svg>', 'SVG_UNSAFE_ATTRIBUTE')
  })

  it('rejects dangerous XML, CSS and non-fragment references', () => {
    expectFailure('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 10 10"><text>&xxe;</text></svg>', 'SVG_INVALID_XML')
    expectFailure('<svg viewBox="0 0 10 10"><style>text, rect { fill: red }</style><text>x</text></svg>', 'SVG_UNSAFE_ATTRIBUTE')
    expectFailure('<svg viewBox="0 0 10 10"><style>.x { fill: url(https://example.com/a.svg) }</style><text class="x">x</text></svg>', 'SVG_UNSAFE_ATTRIBUTE')
    expectFailure('<svg viewBox="0 0 10 10"><use href="other.svg#shape" /></svg>', 'SVG_UNSAFE_REFERENCE')
    expectFailure('<svg viewBox="0 0 10 10"><path d="M0 0L1 1" marker-end="url(#missing)" /></svg>', 'SVG_UNSAFE_REFERENCE')
  })

  it('rejects unsupported filters, excessive shadow parameters and use cycles', () => {
    expectFailure('<svg viewBox="0 0 10 10"><defs><filter id="f"><feTurbulence /></filter></defs></svg>', 'SVG_UNSUPPORTED_ELEMENT')
    expectFailure('<svg viewBox="0 0 10 10"><defs><filter id="f"><feDropShadow stdDeviation="21" /></filter></defs></svg>', 'SVG_RESOURCE_LIMIT')
    expectFailure('<svg viewBox="0 0 10 10"><defs><symbol id="a"><use href="#b" /></symbol><symbol id="b"><use href="#a" /></symbol></defs><use href="#a" /></svg>', 'SVG_UNSAFE_REFERENCE')
  })

  it('rejects acyclic use graphs whose rendered expansion exceeds the budget', () => {
    const levels = ['<g id="n0"><path d="M0 0 h1 v1 H0 z" /></g>']
    for (let index = 1; index <= 20; index += 1) {
      levels.push(`<g id="n${index}"><use href="#n${index - 1}" /><use href="#n${index - 1}" /></g>`)
    }
    expectFailure(
      `<svg viewBox="0 0 10 10"><defs>${levels.join('')}</defs><use href="#n20" /></svg>`,
      'SVG_RESOURCE_LIMIT',
    )
  })

  it('enforces viewBox, depth, element, text and source budgets', () => {
    expectFailure('<svg><rect width="1" height="1" /></svg>', 'SVG_INVALID_VIEWBOX')
    expectFailure('<svg viewBox="0 0 13000 10" />', 'SVG_INVALID_VIEWBOX')
    expectFailure(`<svg viewBox="0 0 100 100">${'<g>'.repeat(33)}${'</g>'.repeat(33)}</svg>`, 'SVG_RESOURCE_LIMIT')
    expectFailure(`<svg viewBox="0 0 100 100">${'<circle cx="1" cy="1" r="1" />'.repeat(2_000)}</svg>`, 'SVG_RESOURCE_LIMIT')
    expectFailure(`<svg viewBox="0 0 100 100"><text>${'中'.repeat(32_001)}</text></svg>`, 'SVG_RESOURCE_LIMIT')
    expectFailure(`<svg viewBox="0 0 100 100"><desc>${'a'.repeat(256 * 1024)}</desc></svg>`, 'SVG_RESOURCE_LIMIT')
  })

  it('replaces SVG fences in exported HTML with rendered SVG or neutral errors', () => {
    const escaped = completeSvg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const success = processRestrictedSvgInHtml(`<pre class="language-svg"><code class="language-svg">${escaped}</code></pre>`)
    expect(success).toContain('svg-wrapper')
    expect(success).toContain('svg-container')
    expect(success).toContain('<svg')
    expect(success).not.toContain('language-svg')

    const failure = processRestrictedSvgInHtml('<pre class="language-svg"><code>&lt;svg viewBox="0 0 10 10"&gt;&lt;script/&gt;&lt;/svg&gt;</code></pre>')
    expect(failure).toContain('svg-error')
    expect(failure).not.toContain('<script')
  })
})
