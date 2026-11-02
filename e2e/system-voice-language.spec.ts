import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures/electron'

for (const systemVoice of ['', '语舒', 'fixture-unavailable-voice']) {
  test(`真实系统语音静音验证中文与英文回退：${systemVoice || 'auto'}`, async ({ page, electronApp, testDir }, info) => {
    await page.evaluate(async voice => {
      const settings = await window.api.getReadAloudSettings()
      settings.activeProviderId = 'edge'
      settings.fallbackToSystem = true
      settings.providers.find(provider => provider.id === 'system')!.voice = voice || undefined
      settings.providers.find(provider => provider.id === 'edge')!.voice = 'zh-CN-YunxiNeural'
      await window.api.updateReadAloudSettings(settings)
    }, systemVoice)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.app')).toBeVisible()
    const path = join(testDir, '中文系统回退.md')
    writeFileSync(path, '# 中文测试\n\n这是中文语音测试。\n\nHello world.')
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), path)
    await expect(page.locator('.markdown-body h1')).toHaveText('中文测试')
    await expect.poll(() => page.evaluate(() => speechSynthesis.getVoices().filter(voice => voice.lang === 'zh-CN').length)).toBeGreaterThan(0)
    const selectedVoiceLanguage = await page.evaluate(id => speechSynthesis.getVoices().find(voice => voice.voiceURI === id || voice.name === id)?.lang, systemVoice)
    await electronApp.evaluate(({ ipcMain }) => {
      ;(ipcMain as any)._invokeHandlers.set('tts:synthesize', async () => ({ ok: false, kind: 'network', message: 'self-fixture offline' }))
    })
    await page.evaluate(() => {
      const rows: Array<{ text: string; lang: string; voiceLang?: string; started: boolean; ended: boolean; error?: string }> = []
      Object.assign(window, { __nativeLanguageSpeech: rows })
      const speak = speechSynthesis.speak.bind(speechSynthesis)
      Object.defineProperty(speechSynthesis, 'speak', { configurable: true, value: (utterance: SpeechSynthesisUtterance) => {
        const row = { text: utterance.text, lang: utterance.lang, voiceLang: utterance.voice?.lang, started: false, ended: false, error: undefined as string | undefined }
        rows.push(row)
        utterance.volume = 0
        utterance.addEventListener('start', () => { row.started = true })
        utterance.addEventListener('end', () => { row.ended = true })
        utterance.addEventListener('error', event => { row.error = event.error })
        speak(utterance)
      } })
    })
    await page.getByRole('button', { name: '朗读', exact: true }).click()
    const controls = page.getByRole('group', { name: '朗读控制' })
    await expect(controls.getByRole('combobox', { name: 'Edge 音色' })).toHaveValue('zh-CN-YunxiNeural')
    await controls.getByRole('button', { name: '开始朗读' }).click()
    await expect(controls.locator('.read-aloud-fallback')).toBeVisible()
    const read = () => page.evaluate(() => (window as any).__nativeLanguageSpeech as Array<{ text: string; lang: string; voiceLang: string; started: boolean; ended: boolean; error?: string }>)
    await expect.poll(async () => (await read()).filter(row => row.ended).length, { timeout: 20000 }).toBe(3)
    const rows = await read()
    await info.attach('native-speech-events', { body: JSON.stringify({ systemVoice, selectedVoiceLanguage, rows, volume: 0, networkInjected: true }), contentType: 'application/json' })
    // 有效显式音色保持用户选择；名称是否本地化取决于当前 Electron 包的语言。
    const languages = selectedVoiceLanguage ? Array(3).fill(selectedVoiceLanguage) : ['zh-CN', 'zh-CN', 'en-US']
    expect(rows.map(row => row.lang)).toEqual(languages)
    expect(rows[0].lang).toBe('zh-CN')
    expect(rows[1].lang).toBe('zh-CN')
    expect(rows.every(row => row.started && row.ended && !row.error)).toBe(true)
    expect(rows.map(row => row.voiceLang)).toEqual(languages)
    await page.screenshot({ path: info.outputPath('native-language-fallback.png'), animations: 'disabled' })
  })
}
