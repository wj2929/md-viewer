import { describe, expect, it } from 'vitest'
import { extractGuiLaunchPath } from '../cli/launchArgs'

describe('extractGuiLaunchPath', () => {
  it('keeps the existing direct file launch behavior', () => {
    expect(extractGuiLaunchPath(['/tmp/report.md'])).toBe('/tmp/report.md')
  })

  it('extracts the target from the GUI open command', () => {
    expect(extractGuiLaunchPath(['open', '/tmp/report.md'])).toBe('/tmp/report.md')
  })

  it('ignores open command flags when extracting the target path', () => {
    expect(extractGuiLaunchPath(['open', '/tmp/report.md', '--line', '120'])).toBe('/tmp/report.md')
    expect(extractGuiLaunchPath(['open', '/tmp/report.md', '--heading', '部署说明'])).toBe('/tmp/report.md')
  })

  it('ignores runtime and Electron arguments', () => {
    expect(extractGuiLaunchPath(['--inspect', 'dist/main/index.js', '/tmp/report.md'])).toBe('/tmp/report.md')
  })
})
