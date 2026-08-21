import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'read-aloud-visual')

test.describe('语音服务声音方案', () => {
  test('朗读中显示当前句高亮、播放进度和睡眠定时', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const fileName = '长文朗读示例.md'
    const filePath = join(testDir, fileName)
    writeFileSync(filePath, [
      '# 长文朗读示例',
      '',
      'MD Viewer 可以在阅读长文时逐句朗读，并同步标出当前正在播放的句子。',
      '',
      '当前句会保持柔和高亮，页面只在文字离开可见区域后自动跟随，避免阅读画面频繁跳动。',
      '',
      '你还可以调整语速、选择声音，并设置睡眠定时停止。',
    ].join('\n'))

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1200, height: 760 })
    })
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row', { hasText: fileName }).click()

    await page.evaluate(() => {
      const pending: SpeechSynthesisUtterance[] = []
      let speakCount = 0
      const speechSynthesis = {
        speaking: false,
        pending: false,
        paused: false,
        getVoices: () => [],
        cancel: () => { pending.length = 0 },
        pause: () => {},
        resume: () => {},
        speak: (utterance: SpeechSynthesisUtterance) => {
          pending.push(utterance)
          speakCount += 1
          window.setTimeout(() => {
            utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)
            if (speakCount === 1) {
              utterance.onend?.(new Event('end') as SpeechSynthesisEvent)
            }
          }, 0)
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        onvoiceschanged: null,
      }
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speechSynthesis })
    })

    await page.getByRole('button', { name: '朗读', exact: true }).click()
    const controls = page.getByRole('group', { name: '朗读控制' })
    await controls.getByRole('combobox', { name: '朗读服务' }).selectOption('system')
    await expect(controls.getByRole('combobox', { name: '朗读服务' })).toHaveValue('system')
    await controls.getByRole('button', { name: '开始朗读' }).click()
    await expect(controls.getByRole('button', { name: '暂停朗读' })).toBeVisible()
    await expect(controls.locator('.read-aloud-progress')).toContainText(/2\/\d+ 段/)

    await controls.getByRole('combobox', { name: '睡眠定时停止' }).selectOption('5')
    await expect(controls.locator('.read-aloud-sleep-remaining')).toContainText('剩余 05:00')

    const readHighlight = () => page.evaluate(() => {
      const registry = (CSS as typeof CSS & {
        highlights?: { get(name: string): Iterable<Range> | undefined }
      }).highlights
      const ranges = registry?.get('reading-aloud')
      if (ranges) {
        const rangeList = Array.from(ranges)
        return {
          count: rangeList.length,
          text: rangeList.map(range => range.toString()).join(' '),
        }
      }

      const fallback = Array.from(document.querySelectorAll('.markdown-body .reading-highlight'))
      return {
        count: fallback.length,
        text: fallback.map(element => element.textContent ?? '').join(' '),
      }
    })
    await expect.poll(readHighlight).toMatchObject({ count: 1 })
    await expect.poll(async () => (await readHighlight()).text)
      .toContain('MD Viewer 可以在阅读长文时逐句朗读')

    await page.screenshot({ path: join(OUT_DIR, 'read-aloud-playing-highlight-sleep.png'), fullPage: true })
  })

  test('新增声音方案后原方案与新方案都保留', async ({ page, electronApp }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1000, height: 800 })
    })

    await page.locator('.nav-settings-btn').click()
    await page.getByRole('tab', { name: '朗读' }).click()
    const panel = page.getByRole('tabpanel', { name: '朗读' })
    await panel.getByRole('button', { name: '+ 添加 OpenAI 服务' }).click()

    const card = panel.locator('.tts-provider-card').last()
    await expect(card.locator('.tts-voice-profile')).toHaveCount(1)
    await expect(card.getByRole('combobox', { name: /默认声音方案/ })).toHaveValue(/voice-profile-/)

    await card.getByRole('button', { name: '+ 添加声音方案' }).click()

    await expect(card.locator('.tts-voice-profile')).toHaveCount(2)
    await expect(card.getByRole('combobox', { name: /默认声音方案/ }).locator('option')).toHaveCount(2)
    await card.screenshot({ path: join(OUT_DIR, 'openai-two-voice-profiles.png') })
  })
})
