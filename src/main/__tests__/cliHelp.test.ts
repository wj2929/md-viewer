import { describe, expect, it } from 'vitest'
import { buildHelpResult, renderHumanHelp } from '../cli/helpCommand'

describe('CLI help', () => {
  it('returns AI-readable help for a command', () => {
    const result = buildHelpResult(['export'])

    expect(result.ok).toBe(true)
    expect(result.command).toBe('help')
    expect(result.results).toMatchObject({
      command: 'export',
      examples: expect.arrayContaining([
        'md-viewer export README.md --format pdf --out README.pdf',
      ]),
    })
  })

  it('renders short human help without JSON wrapping', () => {
    const help = renderHumanHelp()
    expect(help).toContain('md-viewer capabilities --json')
    expect(help).toContain('md-viewer export README.md --format pdf --out README.pdf')
    expect(help).toContain('md-viewer batch e2e/local-real-docs.json --out test-results/release-report.json')
  })
})
