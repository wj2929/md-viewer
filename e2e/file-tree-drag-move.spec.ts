import type { Page } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

/**
 * ⚠️ 覆盖范围局限（务必知悉，别被绿灯误导）：
 * 本套件用 `dispatchEvent` 合成 DragEvent，只能验证 drop → `window.api.moveFile`
 * 的分发逻辑（源载荷解析、目标校验、根投放条移动）。它**测不到**真实鼠标拖动的
 * 启动路径——恰恰是「dragstart 同步栈里触发 React 重渲染/布局重排会中止原生拖动」
 * 这个实测真凶所在处。历史上多个"实际拖不动"的坏版本，本套件全部通过。
 * 「真实鼠标能否把行拖起来」只能靠手动拖或 Playwright 真实鼠标轨迹验证，
 * 而后者对 Electron 原生 HTML5 拖放模拟本身不可靠——这是本功能自动化的固有盲区。
 *
 * 在真实渲染进程里派发完整 HTML5 拖放事件序列。
 * Playwright 原生拖放模拟对 dataTransfer 传递不可靠，故在页面内手动构造
 * 共享的 DataTransfer 并依次派发 dragstart → (目标)dragover → drop，
 * 真实经过 FileTree 的 React handlers 与 document 级 useDragDrop 拦截。
 * 返回目标行/源行是否定位成功，便于断言前置条件。
 */
async function dragRowToTarget(
  page: Page,
  sourceName: string,
  target: { dirName?: string; toRootBar?: boolean }
): Promise<{ located: boolean }> {
  return page.evaluate(({ sourceName, target }) => {
    const rows = Array.from(document.querySelectorAll('.file-tree-row')) as HTMLElement[]
    const srcRow = rows.find(r => r.querySelector('.file-name')?.textContent?.trim() === sourceName)
    if (!srcRow) return { located: false }

    const dt = new DataTransfer()
    const fire = (el: Element, type: string) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
      el.dispatchEvent(ev)
    }

    fire(srcRow, 'dragstart')

    // dragstart 触发后 React 会渲染出根投放条（仅拖动中显示）
    let targetEl: Element | null = null
    if (target.toRootBar) {
      targetEl = document.querySelector('.file-tree-root-drop')
    } else if (target.dirName) {
      const dirRows = Array.from(document.querySelectorAll('.file-tree-row')) as HTMLElement[]
      targetEl = dirRows.find(r => r.querySelector('.file-name')?.textContent?.trim() === target.dirName) ?? null
    }
    if (!targetEl) { fire(srcRow, 'dragend'); return { located: false } }

    fire(targetEl, 'dragover')
    fire(targetEl, 'drop')
    fire(srcRow, 'dragend')
    return { located: true }
  }, { sourceName, target })
}

test.describe('文件树拖放移动', () => {
  test('拖文件到子目录 → 文件移动，源不再在原处', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-row')

    const source = join(testDir, 'test1.md')
    const destination = join(testDir, 'subfolder', 'test1.md')

    const { located } = await dragRowToTarget(page, 'test1.md', { dirName: 'subfolder' })
    expect(located).toBe(true)

    await expect.poll(() => existsSync(destination), { timeout: 8000 }).toBe(true)
    expect(existsSync(source)).toBe(false)
  })

  test('从子目录拖文件到根投放条 → 移动回根目录', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-row')
    // 文件树默认全展开，nested.md 已可见，无需手动展开

    const source = join(testDir, 'subfolder', 'nested.md')
    const destination = join(testDir, 'nested.md')

    // 投放条仅在拖动中渲染：先 dragstart，等 React 渲染出投放条，再 dragover→drop
    await page.evaluate((name) => {
      const rows = Array.from(document.querySelectorAll('.file-tree-row')) as HTMLElement[]
      const srcRow = rows.find(r => r.querySelector('.file-name')?.textContent?.trim() === name)!
      ;(window as any).__dndDt = new DataTransfer()
      srcRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: (window as any).__dndDt }))
    }, 'nested.md')

    await page.waitForSelector('.file-tree-root-drop')

    await page.evaluate(() => {
      const bar = document.querySelector('.file-tree-root-drop')!
      const dt = (window as any).__dndDt
      bar.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      bar.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })

    await expect.poll(() => existsSync(destination), { timeout: 8000 }).toBe(true)
    expect(existsSync(source)).toBe(false)
  })

  test('拖目录到其自身 → 不移动（前端预防）', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-row')

    const original = join(testDir, 'subfolder', 'nested.md')

    const { located } = await dragRowToTarget(page, 'subfolder', { dirName: 'subfolder' })
    expect(located).toBe(true)

    // 给足时间：若误移动，nested.md 会消失
    await page.waitForTimeout(1500)
    expect(existsSync(original)).toBe(true)
  })
})
