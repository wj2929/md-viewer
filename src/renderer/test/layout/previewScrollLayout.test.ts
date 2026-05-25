import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const readProjectFile = (relativePath: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf-8')

describe('preview scroll layout CSS', () => {
  it('keeps preview wrappers as flex height containers so markdown can scroll', () => {
    const mainCss = readProjectFile('src/assets/main.css')
    const splitCss = readProjectFile('src/components/SplitPanel.css')

    expect(mainCss).toMatch(/\.preview-pane\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;/s)
    expect(splitCss).toMatch(/\.split-leaf-panel\s+\.split-preview-pane\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;/s)
  })

  it('constrains new renderer plugin diagrams inside the preview column', () => {
    const mainCss = readProjectFile('src/assets/main.css')

    expect(mainCss).toMatch(/\.vega-lite-wrapper,[\s\S]*\.wavedrom-wrapper\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow:\s*auto;/s)
    expect(mainCss).toMatch(/\.vega-lite-wrapper\s+\.vega-lite-container,[\s\S]*\.wavedrom-wrapper\s+\.wavedrom-container\s*\{[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*center;/s)
    expect(mainCss).toMatch(/\.vega-lite-wrapper\s+\.vega-lite-container\s+svg,[\s\S]*\.wavedrom-wrapper\s+\.wavedrom-container\s+svg\s*\{[\s\S]*max-width:\s*100%;[\s\S]*height:\s*auto;/s)
  })

  it('suppresses the browser default focus ring on mouse-focused markdown preview', () => {
    const markdownCss = readProjectFile('src/assets/markdown.css')

    expect(markdownCss).toMatch(/\.markdown-body:focus\s*\{[^}]*outline:\s*none;/s)
    expect(markdownCss).toMatch(/\.markdown-body:focus-visible\s*\{[^}]*outline:\s*none;/s)
  })
})
