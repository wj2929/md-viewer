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
})
