import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

const projectRoot = process.cwd()
const packageVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version as string
const runPackaged = process.env.MD_VIEWER_PACKAGED_E2E === '1'

function stagedExecutable(): string {
  const staged = join(projectRoot, 'dist', 'staged')
  if (process.platform === 'darwin') {
    const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH?.trim() || process.arch
    const packageDirectory = packageArch === 'x64' ? 'mac' : `mac-${packageArch}`
    return join(staged, packageDirectory, 'MD Viewer.app', 'Contents', 'MacOS', 'MD Viewer')
  }
  if (process.platform === 'win32') return join(staged, 'win-unpacked', 'MD Viewer.exe')

  const candidates = [
    join(staged, `linux-${process.arch}-unpacked`, 'md-viewer'),
    join(staged, 'linux-unpacked', 'md-viewer'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

test.describe('packaged app TTS smoke', () => {
  test.skip(!runPackaged, '设置 MD_VIEWER_PACKAGED_E2E=1 后运行 staged packaged smoke')

  test('真实 packaged GUI 应初始化 TTS IPC 和系统音色界面', async () => {
    test.setTimeout(60_000)
    const executablePath = stagedExecutable()
    expect(existsSync(executablePath), `缺少 packaged executable：${executablePath}`).toBe(true)

    const smokeRoot = join(projectRoot, '.tmp', 'packaged-tts-smoke')
    mkdirSync(smokeRoot, { recursive: true })
    const testDir = mkdtempSync(join(smokeRoot, 'workspace-'))
    const userDataDir = mkdtempSync(join(smokeRoot, 'user-data-'))
    const markdownPath = join(testDir, 'tts-smoke.md')
    writeFileSync(markdownPath, '# TTS Smoke\n\n这是 packaged 应用的系统语音初始化验证。')

    const env = { ...process.env }
    delete env.NODE_ENV
    Object.assign(env, {
      MD_VIEWER_SKIP_RESTORE: '1',
      ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
    })
    let electronApp: ElectronApplication | undefined

    try {
      electronApp = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userDataDir}`, markdownPath],
        cwd: projectRoot,
        env,
        timeout: 30_000,
      })
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.locator('.tab', { hasText: 'tts-smoke.md' }).click()
      await expect(page.locator('.tab.active', { hasText: 'tts-smoke.md' })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.markdown-body')).toContainText(
        '这是 packaged 应用的系统语音初始化验证。',
        { timeout: 15_000 },
      )

      const chartExamples = await page.evaluate(() => window.api.getChartExamplesStatus())
      expect(chartExamples).toMatchObject({
        state: 'ready',
        appVersion: packageVersion,
        packageVersion,
        caseCount: 93,
        rendererCount: 20,
      })
      expect(chartExamples.bytes).toBeGreaterThan(0)

      const settings = await page.evaluate(() => window.api.getReadAloudSettings())
      expect(settings.activeProviderId).toBe('edge')
      expect(settings.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'system', type: 'system', enabled: true }),
        expect.objectContaining({ id: 'edge', type: 'edge', enabled: true }),
      ]))

      await page.getByRole('button', { name: '朗读', exact: true }).click()
      const controls = page.getByRole('group', { name: '朗读控制' })
      const provider = controls.getByRole('combobox', { name: '朗读服务' })
      await expect(provider).toHaveValue('edge')
      await provider.selectOption('system')
      await expect(provider).toHaveValue('system')

      const systemVoice = controls.getByRole('combobox', { name: '系统音色' })
      await expect(systemVoice).toBeVisible()
      await expect(systemVoice.locator('option').first()).toHaveText('系统默认音色')
    } finally {
      await electronApp?.close()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})
