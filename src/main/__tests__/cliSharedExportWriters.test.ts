import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildExportHtmlDocument, buildExportPdfDocument, writeHtmlExport } from '../cli/sharedExportWriters'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('shared export writers', () => {
  it('wraps rendered markdown HTML with a stable document shell', () => {
    const html = buildExportHtmlDocument({
      content: '<h1>Report</h1><div class="mermaid-toggle-bar no-export">toolbar</div>',
      title: 'A&B <Report>',
      markdownCss: '.markdown-body { color: #111; }',
      prismCss: 'code { color: #333; }',
      showBranding: true,
    })

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<title>A&amp;B &lt;Report&gt;</title>')
    expect(html).toContain('<div class="markdown-body">')
    expect(html).toContain('<h1>Report</h1>')
    expect(html).toContain('由 <a href="https://github.com/wj2929/md-viewer"')
    expect(html).toContain('.no-export')
    expect(html).toContain('[data-no-export="true"]')
    expect(html).toContain('display: none !important')
  })

  it('writes the HTML document and returns artifact metadata', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-html-writer-'))
    const outputPath = path.join(tempDir, 'report.html')

    const artifact = await writeHtmlExport(outputPath, {
      content: '<p>Hello</p>',
      title: 'report.md',
      markdownCss: '',
      prismCss: '',
      showBranding: false,
    })

    expect(artifact.type).toBe('html')
    expect(artifact.path).toBe(outputPath)
    expect(artifact.bytes).toBeGreaterThan(100)
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('<p>Hello</p>')
  })

  it('builds the shared PDF document shell with chart sizing and branding rules', () => {
    const html = buildExportPdfDocument({
      content: '<div class="graphviz-container"><svg></svg><div class="graphviz-toggle-bar no-export">toolbar</div></div>',
      title: 'report.md',
      markdownCss: '.markdown-body { color: #111; }',
      prismCss: 'code { color: #333; }',
      showBranding: true,
    })

    expect(html).toContain('.markdown-body .graphviz-container')
    expect(html).toContain('justify-content: center !important')
    expect(html).toContain('max-width: 150mm')
    expect(html).toContain('max-height: 180mm')
    expect(html).toContain('white-space: pre-wrap !important')
    expect(html).toContain('<div class="pdf-export-branding">由 MD Viewer 生成 · github.com/wj2929/md-viewer</div>')
    expect(html).toContain('.no-export')
    expect(html).toContain('[data-no-export="true"]')
    expect(html).toContain('display: none !important')
  })
})
