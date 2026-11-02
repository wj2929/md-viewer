import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRootWatchPolicy } from '../watching/watchPolicy'
import { hasIgnoredPathSegment } from '../watching/watchPaths'
import { isWatchResponse, isRelativeWatchPath, safeWatchError } from '../watching/watchProtocol'

describe('watch process policy and protocol', () => {
  it('only prunes project sibling outputs; discovery rules remain unchanged', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-watch-policy-'))
    writeFileSync(path.join(root, 'demo.csproj'), '')
    mkdirSync(path.join(root, 'bin'))
    writeFileSync(path.join(root, 'bin/manual.md'), '# hand written')
    mkdirSync(path.join(root, 'docs/bin'), { recursive: true })
    const policy = createRootWatchPolicy(root)
    expect(policy.ignored(path.join(root, 'bin'), statSync(path.join(root, 'bin')))).toBe(true)
    expect(policy.ignored(path.join(root, 'docs/bin'), statSync(path.join(root, 'docs/bin')))).toBe(false)
    expect(hasIgnoredPathSegment(path.join(root, 'bin/manual.md'), root)).toBe(false)
    expect(createRootWatchPolicy(path.join(root, 'bin')).ignored(path.join(root, 'bin'))).toBe(false)
    expect([...policy.excluded]).toEqual(['bin'])
  })

  it('does not turn the old unsupported batch glob into a new exclusion', () => {
    const policy = createRootWatchPolicy('/ws/root')
    expect(policy.ignored('/ws/root/batch1/a.md')).toBe(false)
    expect(policy.ignored('/ws/root/node_modules/a.md')).toBe(true)
  })

  it('accepts POSIX colons while rejecting Windows drive and ADS paths', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      for (const value of ['colon:name.md', 'a:b.md', '目录:甲/说明.md']) {
        expect(isRelativeWatchPath(value, platform)).toBe(true)
      }
    }
    for (const value of ['colon:name.md', 'a.md:stream', 'C:/a', 'C:a']) {
      expect(isRelativeWatchPath(value, 'win32')).toBe(false)
    }
  })

  it('validates bounded startup observations without arbitrary stages or numeric payloads', () => {
    const message = { processGeneration: 1, watchId: 1, watchGeneration: 1,
      type: 'startup-progress', stage: 'path-check-start', elapsedMs: 0, pathChecks: 0, directoryChecks: 0 }
    expect(isWatchResponse(message)).toBe(true)
    for (const stage of ['path-checked', 'watch-create-start', 'watch-created', 'crawl-progress']) {
      expect(isWatchResponse({ ...message, stage })).toBe(true)
    }
    expect(isWatchResponse({ ...message, stage: '/private/path' })).toBe(false)
    for (const key of ['elapsedMs', 'pathChecks', 'directoryChecks', 'watchGeneration']) {
      for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
        expect(isWatchResponse({ ...message, [key]: value })).toBe(false)
      }
    }
  })

  it('rejects traversal, oversized batches, raw errors and untrusted generations', () => {
    for (const p of ['../a', '/etc/passwd', 'a/../b', 'a\\b', 'a\0b']) expect(isRelativeWatchPath(p)).toBe(false)
    const base = { processGeneration: 1, watchId: 1, watchGeneration: 1 }
    expect(isWatchResponse({ ...base, type: 'events', events: Array(129).fill({ kind: 'change', path: 'a.md', sequence: 1, observedAt: 0 }) })).toBe(false)
    expect(isWatchResponse({ ...base, type: 'error', code: '/private/secret' })).toBe(false)
    expect(isWatchResponse({ ...base, type: 'gap', gapId: 1.5 })).toBe(false)
    expect(safeWatchError(new Error('secret'))).toBe('UNKNOWN')
  })
})
