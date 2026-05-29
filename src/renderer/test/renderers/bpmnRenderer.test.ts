import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processBpmnInHtml, renderBpmnToSvg, resolveBpmnRefPath, validateBpmnSource } from '../../src/utils/bpmnRenderer'

let mockedBpmnSvg = '<svg viewBox="0 0 100 60"><circle cx="18" cy="18" r="18"></circle></svg>'

vi.mock('bpmn-js/lib/Viewer', () => ({
  default: class {
    constructor(_options: { container: HTMLElement }) {}

    async importXML(_xml: string) {
      return { warnings: [] }
    }

    async saveSVG() {
      return { svg: mockedBpmnSvg }
    }

    destroy() {}
  },
}))

const VALID_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="156" y="81" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}

describe('bpmnRenderer', () => {
  beforeEach(() => {
    mockedBpmnSvg = '<svg viewBox="0 0 100 60"><circle cx="18" cy="18" r="18"></circle></svg>'
  })

  it('renders BPMN XML to SVG', async () => {
    const result = await renderBpmnToSvg(VALID_BPMN)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('</svg>')
    }
  })

  it('sanitizes dangerous SVG returned by the BPMN renderer', async () => {
    mockedBpmnSvg = '<svg onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><text>bad</text></a><foreignObject><div>bad</div></foreignObject><circle cx="1" cy="1" r="1"></circle></svg>'

    const result = await renderBpmnToSvg(VALID_BPMN)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('<circle')
      expect(result.svg).not.toContain('<script')
      expect(result.svg).not.toContain('onload')
      expect(result.svg).not.toContain('javascript:')
      expect(result.svg).not.toContain('foreignObject')
    }
  })

  it('does not upscale BPMN diagrams to the full preview width', async () => {
    mockedBpmnSvg = '<svg viewBox="0 0 620 220"><path d="M 0 0 L 100 0" stroke="black" fill="none"></path></svg>'

    const result = await renderBpmnToSvg(VALID_BPMN)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('width="620"')
      expect(result.svg).not.toContain('width="100%"')
      expect(result.svg).toContain('max-width: 100%')
    }
  })

  it('preserves BPMN connection strokes when exported SVG relies on editor styles', async () => {
    mockedBpmnSvg = [
      '<svg viewBox="0 0 200 80">',
      '<g class="djs-element djs-connection" data-element-id="Flow_1">',
      '<g class="djs-visual">',
      '<defs><marker id="marker-flow-1" viewBox="0 0 20 20"><path d="M 1 5 L 11 10 L 1 15 Z"></path></marker></defs>',
      '<path data-corner-radius="5" d="M10,20L120,20"></path>',
      '<path class="djs-hit djs-hit-stroke" d="M10,20L120,20" style="fill: none; stroke-opacity: 0; stroke: white; stroke-width: 15px;"></path>',
      '</g>',
      '</g>',
      '</svg>',
    ].join('')

    const result = await renderBpmnToSvg(VALID_BPMN)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('fill="none"')
      expect(result.svg).toContain('stroke-width="2"')
      expect(result.svg).toContain('marker-end="url(#marker-flow-1)"')
    }
  })

  it('keeps short CJK BPMN labels horizontal after bpmn-js wraps them per character', async () => {
    mockedBpmnSvg = [
      '<svg viewBox="0 0 120 80">',
      '<text lineheight="1.2" class="djs-label">',
      '<tspan x="5.5" y="9.9">提</tspan>',
      '<tspan x="5.5" y="23.1">交</tspan>',
      '</text>',
      '</svg>',
    ].join('')

    const result = await renderBpmnToSvg(VALID_BPMN)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('>提交<')
      expect(result.svg).not.toContain('>提</tspan><tspan')
    }
  })

  it('rejects malformed BPMN XML before rendering', () => {
    const result = validateBpmnSource('<definitions>')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BPMN_INVALID_XML')
    }
  })

  it('blocks URL and traversal BPMN references', () => {
    expect(() => resolveBpmnRefPath('/docs/report.md', 'https://example.com/a.bpmn')).toThrow(/URL/)
    expect(() => resolveBpmnRefPath('/docs/report.md', '../a.bpmn')).toThrow(/不能引用 Markdown 所在目录之外/)
  })

  it('replaces BPMN code blocks in exported html', async () => {
    const result = await processBpmnInHtml(`<pre class="language-bpmn"><code class="language-bpmn">${escapeHtml(VALID_BPMN)}</code></pre>`)

    expect(result).toContain('bpmn-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('language-bpmn')
  })

  it('reads .bpmn image references through the safe reader when exporting', async () => {
    const readBpmnFile = vi.fn().mockResolvedValue({ content: VALID_BPMN, resolvedPath: '/docs/flow.bpmn' })
    global.window.api = {
      ...global.window.api,
      readBpmnFile,
    } as typeof window.api

    const result = await processBpmnInHtml('<p><img src="./flow.bpmn?raw=1#v" alt="流程"></p>', {
      markdownFilePath: '/docs/report.md',
    })

    expect(readBpmnFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/report.md',
      refPath: './flow.bpmn',
    })
    expect(result).toContain('bpmn-container')
    expect(result).toContain('<svg')
  })

  it('replaces BPMN file placeholders in exported html', async () => {
    const readBpmnFile = vi.fn().mockResolvedValue({ content: VALID_BPMN, resolvedPath: '/docs/flow.bpmn' })
    global.window.api = {
      ...global.window.api,
      readBpmnFile,
    } as typeof window.api

    const result = await processBpmnInHtml(
      '<div class="bpmn-file-placeholder" data-bpmn-src="./flow.bpmn" data-bpmn-alt="流程"></div>',
      { markdownFilePath: '/docs/report.md' }
    )

    expect(readBpmnFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/report.md',
      refPath: './flow.bpmn',
    })
    expect(result).toContain('bpmn-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('bpmn-file-placeholder')
    expect(result).not.toContain('data-bpmn-src')
  })

  it('falls back to readFile when readBpmnFile is unavailable in older preload environments', async () => {
    const readFile = vi.fn().mockResolvedValue(VALID_BPMN)
    ;(global.window.api as any).readBpmnFile = undefined
    ;(global.window.api as any).readFile = readFile

    const result = await processBpmnInHtml('<p><img src="./flow.bpmn" alt="流程"></p>', {
      markdownFilePath: '/docs/report.md',
    })

    expect(readFile).toHaveBeenCalledWith('/docs/flow.bpmn')
    expect(result).toContain('bpmn-container')
    expect(result).toContain('<svg')
  })

  it('falls back to readFile when readBpmnFile IPC handler is missing in older main processes', async () => {
    const readBpmnFile = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'fs:readBpmnFile': Error: No handler registered for 'fs:readBpmnFile'")
    )
    const readFile = vi.fn().mockResolvedValue(VALID_BPMN)
    global.window.api = {
      ...global.window.api,
      readBpmnFile,
      readFile,
    } as typeof window.api

    const result = await processBpmnInHtml('<p><img src="./flow.bpmn" alt="流程"></p>', {
      markdownFilePath: '/docs/report.md',
    })

    expect(readBpmnFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/report.md',
      refPath: './flow.bpmn',
    })
    expect(readFile).toHaveBeenCalledWith('/docs/flow.bpmn')
    expect(result).toContain('bpmn-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('No handler registered')
  })
})
