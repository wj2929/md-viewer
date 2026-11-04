import { test, expect } from './fixtures/electron'

test('离线示例与渲染服务铺满内容列，宽窄明暗与短窗不留右侧空栏', async ({ page, electronApp }, testInfo) => {
  test.setTimeout(90_000)
  await page.getByRole('button', { name: /图表与架构图/ }).click()
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
  const samples: Array<{
    width: number
    height: number
    theme: string
    view: string
    leftGap: number
    rightGap: number
    cardRightGap: number
    contentOverflow: number
    pageOverflow: number
    dialogOverflow: number
  }> = []

  for (const [width, height] of [[1400, 900], [1800, 1000], [1000, 720], [800, 720], [1400, 600]]) {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1])
    }, [width, height])
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
      for (const [view, label, selector] of [
        ['examples', '离线示例', '.chart-examples-panel'],
        ['services', '渲染服务', '.chart-service-panel'],
      ]) {
        await page.getByRole('tab', { name: label, exact: true }).click()
        const content = page.locator('.settings-content')
        await content.evaluate(element => { element.scrollTop = 0 })
        const geometry = await page.locator(selector).evaluate(element => {
          const panel = element.getBoundingClientRect()
          const column = document.querySelector('.chart-settings-content')!.getBoundingClientRect()
          const card = element.querySelector('.chart-examples-card, .chart-service-card')!.getBoundingClientRect()
          const dialog = document.querySelector('.settings-panel')!.getBoundingClientRect()
          const scroll = document.querySelector('.settings-content')!
          return {
            leftGap: panel.left - column.left,
            rightGap: column.right - panel.right,
            cardRightGap: column.right - card.right,
            contentOverflow: scroll.scrollWidth - scroll.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
            dialogOverflow: Math.max(0, -dialog.left, dialog.right - innerWidth, -dialog.top, dialog.bottom - innerHeight),
          }
        })
        samples.push({ width, height, theme, view, ...geometry })
        await page.mouse.move(0, 0)
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${view}-${width}-${height}-${theme}.png`) })
        if (view === 'examples') {
          await expect(page.getByText('内置离线示例包已就绪，无需联网。')).toBeVisible()
          await expect(page.getByText(/不会覆盖内容不同的已有示例/)).toBeVisible()
        } else {
          await expect(page.getByText('联网 renderer 会把当前图表源码发送到对应服务。')).toBeVisible()
          await expect(page.getByRole('checkbox', { name: /自动渲染联网图表/ })).toBeChecked()
        }
        const action = page.getByRole('button', { name: view === 'examples' ? '打开离线示例…' : '保存并测试', exact: true })
        await action.scrollIntoViewIfNeeded()
        await expect(action).toBeInViewport({ ratio: 1 })
        if (height === 600) {
          await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${view}-${width}-${height}-${theme}-action.png`) })
        }
      }
    }
  }

  await testInfo.attach('panel-width-measurements', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  for (const sample of samples) {
    const label = `${sample.view} ${sample.width}x${sample.height} ${sample.theme}`
    expect(Math.abs(sample.leftGap), `${label} left alignment`).toBeLessThanOrEqual(1)
    expect(Math.abs(sample.rightGap), `${label} unused right column`).toBeLessThanOrEqual(1)
    expect(Math.abs(sample.cardRightGap), `${label} card right alignment`).toBeLessThanOrEqual(1)
    expect(sample.contentOverflow, `${label} content overflow`).toBeLessThanOrEqual(1)
    expect(sample.pageOverflow, `${label} page overflow`).toBeLessThanOrEqual(1)
    expect(sample.dialogOverflow, `${label} dialog overflow`).toBeLessThanOrEqual(1)
  }
})
