import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXCALIDRAW_LIMITS,
  renderExcalidrawToSvg,
  validateExcalidrawSource,
} from '../../src/utils/excalidrawRenderer'

const exportToSvgMock = vi.hoisted(() => vi.fn(async () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 100 50')
  svg.innerHTML = [
    '<rect width="100" height="50" onclick="alert(1)"></rect>',
    '<a href="javascript:alert(1)"><text>bad</text></a>',
    '<image href="https://example.com/image.png"></image>',
    '<image xlink:href="http://example.com/image.png"></image>',
    '<image href="//example.com/x.svg"></image>',
    '<image href="data:text/html,&lt;svg&gt;bad&lt;/svg&gt;"></image>',
    '<image href="data:image/png;base64,AAAA"></image>',
    '<rect style="fill:url(javascript:alert(1));stroke:url(https://example.com/stroke.png)"></rect>',
    '<rect style="fill:url(//example.com/x.svg#id)"></rect>',
    '<rect fill="url(http://example.com/fill.png)"></rect>',
    '<foreignObject><div>bad</div></foreignObject>',
  ].join('')
  return svg
}))

vi.mock('@excalidraw/excalidraw', () => ({
  exportToSvg: exportToSvgMock,
}))

function excalidrawSource(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'excalidraw',
    elements: [
      {
        id: 'r1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      },
    ],
    appState: {},
    files: {},
    ...overrides,
  })
}

describe('excalidrawRenderer', () => {
  beforeEach(() => {
    exportToSvgMock.mockClear()
  })

  it('合法 Excalidraw JSON 能生成 SVG', async () => {
    const result = await renderExcalidrawToSvg(excalidrawSource(), { sourceKind: 'code-block' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.width).toBe(100)
      expect(result.height).toBe(50)
      expect(result.sourceKind).toBe('code-block')
    }
  })

  it('非 JSON 返回明确错误', async () => {
    const result = await renderExcalidrawToSvg('{bad', { sourceKind: 'code-block' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('JSON')
  })

  it('缺少 elements 返回明确错误', () => {
    const validation = validateExcalidrawSource(JSON.stringify({ type: 'excalidraw' }))

    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.error).toContain('elements')
  })

  it('空 elements 不作为错误输入', async () => {
    const result = await renderExcalidrawToSvg(excalidrawSource({ elements: [] }), {
      sourceKind: 'code-block',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.join('\n')).toContain('空画布')
    }
    expect(exportToSvgMock).toHaveBeenCalledTimes(1)
  })

  it('超过大小限制时拒绝渲染', async () => {
    const oversized = 'x'.repeat(EXCALIDRAW_LIMITS.maxSourceBytes + 1)
    const validation = validateExcalidrawSource(oversized)
    const result = await renderExcalidrawToSvg(oversized, { sourceKind: 'code-block' })

    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.error).toContain('1MB')
    expect(result.ok).toBe(false)
    expect(exportToSvgMock).not.toHaveBeenCalled()
  })

  it('超过 1MB 的合法 JSON 先按 source 大小拒绝', () => {
    const oversized = excalidrawSource({
      appState: {
        note: 'x'.repeat(EXCALIDRAW_LIMITS.maxSourceBytes + 1),
      },
    })

    const validation = validateExcalidrawSource(oversized)

    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.error).toContain('1MB')
      expect(validation.error).not.toContain('10MB')
      expect(validation.error).not.toContain('图片资源')
    }
  })

  it('缺失图片文件时返回 warning 但不整体失败', async () => {
    const result = await renderExcalidrawToSvg(excalidrawSource({
      elements: [
        {
          id: 'i1',
          type: 'image',
          fileId: 'missing',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
        },
      ],
      files: {},
    }), { sourceKind: 'code-block' })

    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toContain('图片资源缺失')
  })

  it('exportToSvg 使用对象参数调用并禁用 embeddables', async () => {
    await renderExcalidrawToSvg(excalidrawSource(), { sourceKind: 'code-block' })

    expect(exportToSvgMock).toHaveBeenCalledWith(expect.objectContaining({
      elements: expect.any(Array),
      appState: expect.any(Object),
      files: expect.any(Object),
      exportPadding: expect.any(Number),
      renderEmbeddables: false,
      skipInliningFonts: true,
    }))
  })

  it('sanitize 会移除事件属性、foreignObject 和外链', async () => {
    const result = await renderExcalidrawToSvg(excalidrawSource(), { sourceKind: 'code-block' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).not.toContain('onclick')
      expect(result.svg).not.toContain('foreignObject')
      expect(result.svg).not.toContain('javascript:')
      expect(result.svg).not.toContain('https://example.com')
      expect(result.svg).not.toContain('http://example.com')
      expect(result.svg).not.toContain('//example.com')
      expect(result.svg).not.toContain('data:text/html')
      expect(result.svg).toContain('data:image/png')
      const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement
      expect(svg.getAttribute('width')).toBe('100')
      expect(svg.getAttribute('height')).toBe('50')
      expect(result.svg).toContain('preserveAspectRatio="xMidYMid meet"')
      expect(result.svg).toContain('max-width: 100%')
    }
  })

  it('非 excalidraw type 但有 elements 时按兼容模式返回 warning', () => {
    const validation = validateExcalidrawSource(excalidrawSource({ type: 'other' }))

    expect(validation.ok).toBe(true)
    expect(validation.warnings.join('\n')).toContain('兼容模式')
  })

  it('elements 超过限制时拒绝', () => {
    const tooManyElements = Array.from({ length: EXCALIDRAW_LIMITS.maxElements + 1 }, (_, index) => ({
      id: String(index),
      type: 'rectangle',
    }))

    const elementsValidation = validateExcalidrawSource(excalidrawSource({
      elements: tooManyElements,
    }))

    expect(elementsValidation.ok).toBe(false)
  })

  it('files 构造导致 source 超过 1MB 时先返回 source 限制错误', () => {
    const tooManyFiles = {
      a: { dataURL: `data:image/png;base64,${'a'.repeat(EXCALIDRAW_LIMITS.maxFilesBytes + 1)}` },
    }

    const validation = validateExcalidrawSource(excalidrawSource({
      files: tooManyFiles,
    }))

    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.error).toContain('1MB')
      expect(validation.error).not.toContain('10MB')
      expect(validation.error).not.toContain('图片资源')
    }
  })
})
