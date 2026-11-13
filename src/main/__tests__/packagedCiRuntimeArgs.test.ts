import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

for (const name of ['inspect-packaged-app', 'smoke-packaged-app']) {
  const script = readFileSync(`scripts/${name}.mjs`, 'utf8')

  describe(`${name} CI runtime arguments`, () => {
    it.each([
      ['darwin', 'x64', 'true', ['--disable-gpu']],
      ['darwin', 'arm64', 'true', []],
      ['linux', 'x64', 'true', []],
      ['win32', 'x64', 'true', []],
      ['darwin', 'x64', undefined, []],
      ['darwin', 'x64', 'false', []],
      ['darwin', 'x64', '1', []],
    ])('limits software rendering to the Intel macOS CI runner: %s %s %s', (platform, packageArch, githubActions, expected) => {
      const start = script.indexOf('const runtimeArgs =')
      expect(start).toBeGreaterThanOrEqual(0)
      const declaration = script.slice(start).split(/\r?\n\s*\r?\n/, 1)[0]
      const args = runInNewContext(`${declaration}\nruntimeArgs`, {
        process: { platform, env: { GITHUB_ACTIONS: githubActions } },
        packageArch,
      })
      expect(args).toEqual(expected)
      expect(script).toContain('...runtimeArgs],')
      expect(script).not.toContain('spawnSync(executablePath, [...runtimeArgs,')
    })
  })
}
