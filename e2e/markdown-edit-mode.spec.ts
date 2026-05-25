import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

async function openMarkdownEditViaIPC(
  electronApp: Parameters<typeof openFolderViaIPC>[0],
  filePath: string,
  leafId?: string
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, params) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:quick-edit', {
      filePath: params.filePath,
      mode: 'document',
      leafId: params.leafId,
    })
  }, { filePath, leafId })
}

test.describe('Markdown 编辑模式', () => {
  test('编辑工作区工具栏按钮应在真实 Electron 中可用', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1200, height: 720 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    const workbench = page.getByLabel('test1.md 编辑工作区')
    await expect(workbench).toBeVisible()

    await expect(workbench.getByRole('tab', { name: /对照预览/ })).toHaveAttribute('aria-selected', 'true')
    await expect(workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toBeChecked()
    await workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' }).uncheck()
    await expect(workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).not.toBeChecked()

    await workbench.getByRole('tab', { name: '仅编辑' }).click()
    await expect(workbench.getByRole('tab', { name: /仅编辑/ })).toHaveAttribute('aria-selected', 'true')
    await expect(workbench.getByRole('textbox', { name: 'Markdown 源码编辑区' })).toBeVisible()
    await expect(workbench.locator('.markdown-workbench-preview-pane')).toHaveCount(0)
    await expect(workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toHaveCount(0)

    const sourceEditor = workbench.locator('.markdown-editor-pane .cm-content')
    await sourceEditor.click()
    await workbench.getByRole('button', { name: '加粗' }).click()
    await expect(sourceEditor).toContainText('**文本**')

    await workbench.getByRole('button', { name: '撤销编辑' }).click()
    await expect(sourceEditor).not.toContainText('**文本**')
    await workbench.getByRole('button', { name: '重做编辑' }).click()
    await expect(sourceEditor).toContainText('**文本**')

    await workbench.getByRole('tab', { name: '对照预览' }).click()
    await expect(workbench.getByRole('tab', { name: /对照预览/ })).toHaveAttribute('aria-selected', 'true')
    await expect(workbench.locator('.markdown-workbench-preview-pane')).toBeVisible()
    await expect(workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toBeVisible()
    await workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' }).check()
    await expect(workbench.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toBeChecked()

    await workbench.getByRole('tab', { name: '预览', exact: true }).click()
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeHidden()
    await expect(page.locator('.preview-pane .markdown-body')).toBeVisible()
  })

  test('保存和放弃编辑按钮应在真实 Electron 中可用', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    const workbench = page.getByLabel('test1.md 编辑工作区')
    await expect(workbench).toBeVisible()

    const sourceEditor = workbench.locator('.markdown-editor-pane .cm-content')
    await sourceEditor.click()
    await page.keyboard.press('End')
    await page.keyboard.type('\nNew draft line')
    await expect(workbench.getByRole('button', { name: '保存修改' })).toBeEnabled()

    await workbench.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()
    await expect(workbench.locator('.markdown-workbench-preview-pane .markdown-body')).toContainText('New draft line')

    await workbench.getByRole('button', { name: '退出编辑模式' }).click()
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeHidden()
    await expect(page.locator('.preview-pane .markdown-body')).toContainText('New draft line')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    await expect(workbench).toBeVisible()
    const discardTarget = workbench.locator('.markdown-editor-pane .cm-content')
    await discardTarget.click()
    await page.keyboard.press('End')
    await page.keyboard.type('\nDiscard me')
    await expect(workbench.getByRole('button', { name: '放弃编辑' })).toBeVisible()

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('放弃未保存的编辑草稿')
      await dialog.accept()
    })
    await workbench.getByRole('button', { name: '放弃编辑' }).click()
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeHidden()
    await expect(page.locator('.preview-pane .markdown-body')).not.toContainText('Discard me')
  })

  test('支持进入、源码编辑、渲染区编辑并退出编辑模式', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await expect(page.getByRole('button', { name: '编辑文档' })).toHaveCount(0)
    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Markdown 源码编辑区' })).toBeVisible()
    await expect(page.getByText('预览已更新')).toBeVisible()

    const previewParagraph = page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })
    await expect(previewParagraph).toBeVisible()
    await previewParagraph.fill('Hello from rendered preview')
    await page.getByRole('button', { name: '退出编辑模式' }).click()

    await expect(page.getByLabel('test1.md 编辑工作区')).toBeHidden()
    await expect(page.getByRole('button', { name: '编辑文档' })).toHaveCount(0)
    await expect(page.locator('.preview-pane .markdown-body p', { hasText: 'Hello from rendered preview' })).toBeVisible()
  })

  test('支持取消或确认放弃未保存编辑草稿', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()

    const previewParagraph = page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })
    await previewParagraph.fill('Draft to discard')
    await expect(page.getByRole('button', { name: '放弃编辑' })).toBeVisible()

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('放弃未保存的编辑草稿')
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: '放弃编辑' }).click()
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Draft to discard',
    })).toBeVisible()

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('放弃未保存的编辑草稿')
      await dialog.accept()
    })
    await page.getByRole('button', { name: '放弃编辑' }).click()

    await expect(page.getByLabel('test1.md 编辑工作区')).toBeHidden()
    await expect(page.getByRole('button', { name: '编辑文档' })).toHaveCount(0)
    await expect(page.locator('.preview-pane .markdown-body p', { hasText: 'Hello World' })).toBeVisible()
    await expect(page.locator('.preview-pane .markdown-body p', { hasText: 'Draft to discard' })).toHaveCount(0)
  })

  test('列表、表格单元格和普通代码块可直接编辑，图表代码块走源码编辑', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'editable-blocks.md'), [
      '# Editable Blocks',
      '',
      '- **最终脚本设置：** `MAX_REQ=490/10秒`，20线程并发',
      '',
      '| 数据 | 状态 |',
      '| --- | --- |',
      '| 频道汇总统计 | 完成 |',
      '',
      '```text',
      'BaseUrl: http://api.polyv.net/',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("editable-blocks.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Editable Blocks')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'editable-blocks.md'))
    await expect(page.getByLabel('editable-blocks.md 编辑工作区')).toBeVisible()

    const editableListItem = page.locator('.markdown-workbench-preview-pane li.markdown-preview-editable-block', {
      hasText: 'MAX_REQ=490/10秒',
    })
    await expect(editableListItem).toBeVisible()
    await editableListItem.fill('最终脚本设置：MAX_REQ=480/10秒，20线程并发')

    const editableStatusCell = page.locator('.markdown-workbench-preview-pane td.markdown-preview-editable-block', {
      hasText: '完成',
    })
    await expect(editableStatusCell).toBeVisible()
    await editableStatusCell.fill('处理中')

    const editableCodeBlock = page.locator('.markdown-workbench-preview-pane pre.markdown-preview-editable-block', {
      hasText: 'BaseUrl: http://api.polyv.net/',
    })
    await expect(editableCodeBlock).toBeVisible()
    await editableCodeBlock.fill('BaseUrl: https://api.polyv.net/')

    const sourceEditor = page.locator('.markdown-editor-pane .cm-content')
    await expect(sourceEditor).toContainText('MAX_REQ=480/10秒')
    await expect(sourceEditor).toContainText('处理中')
    await expect(sourceEditor).toContainText('BaseUrl: https://api.polyv.net/')

    await expect(page.locator('.markdown-workbench-preview-pane pre.language-mermaid.markdown-preview-editable-block')).toHaveCount(0)
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-source-only-hint:visible')).toHaveCount(0)
    await expect(page.locator('.markdown-workbench-preview-pane .mermaid-wrapper')).toBeVisible()
    await expect(page.locator('.markdown-workbench-preview-pane .mermaid-action-btn[data-action="toggleCode"]')).toHaveCount(1)

    await page.getByRole('button', { name: '退出编辑模式' }).click()
    await expect(page.getByLabel('editable-blocks.md 编辑工作区')).toBeHidden()

    await expect(page.locator('.preview-pane .markdown-body li', {
      hasText: 'MAX_REQ=480/10秒',
    })).toBeVisible()
    await expect(page.locator('.preview-pane .markdown-body td', { hasText: '处理中' })).toBeVisible()
    await expect(page.locator('.preview-pane .markdown-body pre', {
      hasText: 'BaseUrl: https://api.polyv.net/',
    })).toBeVisible()
  })

  test('支持快捷键撤销和重做渲染区已提交编辑', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()

    const previewParagraph = page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })
    await previewParagraph.fill('Hello with undo')
    await page.locator('.markdown-workbench-toolbar').click()
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello with undo',
    })).toBeVisible()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })).toBeVisible()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z')
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello with undo',
    })).toBeVisible()
  })

  test('渲染区编辑后应保持预览滚动位置', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'scroll-preserve.md'), [
      '# Scroll Preserve',
      '',
      ...Array.from({ length: 42 }, (_, index) => [
        `## Section ${index + 1}`,
        '',
        `Paragraph ${index + 1} before inline rendered editing.`,
        '',
      ]).flat(),
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("scroll-preserve.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Scroll Preserve')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'scroll-preserve.md'))
    await expect(page.getByLabel('scroll-preserve.md 编辑工作区')).toBeVisible()

    const targetParagraph = page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'Paragraph 30 before inline rendered editing.',
    })
    await targetParagraph.scrollIntoViewIfNeeded()
    await expect(targetParagraph).toBeVisible()

    const beforeTop = await page.locator('.markdown-workbench-preview-pane .preview').evaluate(element => element.scrollTop)
    expect(beforeTop).toBeGreaterThan(300)

    await targetParagraph.fill('Paragraph 30 after inline rendered editing.')
    await page.locator('.markdown-workbench-preview-status').click()
    await expect(page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'Paragraph 30 after inline rendered editing.',
    })).toBeVisible()

    const afterTop = await page.locator('.markdown-workbench-preview-pane .preview').evaluate(async element => {
      await new Promise(resolve => setTimeout(resolve, 450))
      return element.scrollTop
    })
    expect(afterTop).toBeGreaterThan(beforeTop - 120)
  })

  test('连续点击渲染段落并快速输入不应丢失输入', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'rapid-rendered-input.md'), [
      '# Rapid Rendered Input',
      '',
      'First paragraph before edit.',
      '',
      'Second paragraph before edit.',
      '',
      'Third paragraph before edit.',
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("rapid-rendered-input.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Rapid Rendered Input')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'rapid-rendered-input.md'))
    await expect(page.getByLabel('rapid-rendered-input.md 编辑工作区')).toBeVisible()

    const firstParagraph = page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'First paragraph before edit.',
    })
    const secondParagraph = page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'Second paragraph before edit.',
    })

    await firstParagraph.fill('First paragraph after edit.')
    await page.locator('.markdown-workbench-preview-status').click()
    await expect(page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'First paragraph after edit.',
    })).toBeVisible()

    await secondParagraph.click()
    await page.keyboard.type(' quick input')
    await page.waitForTimeout(500)

    await expect(page.locator('.markdown-workbench-preview-pane p.markdown-preview-editable-block', {
      hasText: 'quick input',
    })).toBeVisible()
  })

  test('支持源码区与预览区同步滚动', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'scroll-sync.md'), [
      '# Scroll Sync',
      '',
      ...Array.from({ length: 48 }, (_, index) => [
        `## Section ${index + 1}`,
        '',
        `Paragraph ${index + 1} with enough text to create a readable rendered block and keep source mapping stable.`,
        '',
        '- item one',
        '- item two',
        '',
      ]).flat(),
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("scroll-sync.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Scroll Sync')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'scroll-sync.md'))
    await expect(page.getByLabel('scroll-sync.md 编辑工作区')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toBeChecked()

    await page.waitForFunction(() => {
      const editor = document.querySelector<HTMLElement>('.markdown-edit-workbench .cm-scroller')
      const preview = document.querySelector<HTMLElement>('.markdown-workbench-preview-pane .preview')
      return Boolean(
        editor &&
        preview &&
        editor.scrollHeight > editor.clientHeight + 200 &&
        preview.scrollHeight > preview.clientHeight + 200
      )
    })

    const previewAlignmentAfterEditorScroll = await page.evaluate(async () => {
      const editor = document.querySelector<HTMLElement>('.markdown-edit-workbench .cm-scroller')
      const preview = document.querySelector<HTMLElement>('.markdown-workbench-preview-pane .preview')
      if (!editor || !preview) throw new Error('missing editor or preview scroller')
      editor.scrollTop = Math.round((editor.scrollHeight - editor.clientHeight) * 0.52)
      await new Promise(resolve => requestAnimationFrame(resolve))
      const initialEditorRect = editor.getBoundingClientRect()
      const targetSection = Array.from(editor.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => ({ text: line.textContent?.trim() || '', rect: line.getBoundingClientRect() }))
        .find(line => line.text.startsWith('## Section ') && line.rect.bottom > initialEditorRect.top + 1)
      if (!targetSection) throw new Error('missing visible source section heading')

      editor.scrollTop += Math.round(targetSection.rect.top - initialEditorRect.top)
      editor.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => setTimeout(resolve, 400))
      const editorRect = editor.getBoundingClientRect()
      const visibleSection = Array.from(editor.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => ({ text: line.textContent?.trim() || '', rect: line.getBoundingClientRect() }))
        .find(line => line.text.startsWith('## Section ') && line.rect.bottom > editorRect.top + 1)

      if (!visibleSection) throw new Error('missing visible source section heading')
      const previewHeading = Array.from(preview.querySelectorAll<HTMLElement>('h2'))
        .find(heading => heading.textContent?.trim() === visibleSection.text.replace(/^##\s+/, ''))
      if (!previewHeading) throw new Error(`missing preview heading for ${visibleSection.text}`)

      const previewRect = preview.getBoundingClientRect()
      const headingRect = previewHeading.getBoundingClientRect()
      return {
        previewTop: preview.scrollTop,
        sourceSection: visibleSection.text,
        headingOffset: Math.round(headingRect.top - previewRect.top),
      }
    })
    expect(previewAlignmentAfterEditorScroll.previewTop).toBeGreaterThan(80)
    expect(previewAlignmentAfterEditorScroll.headingOffset).toBeGreaterThanOrEqual(0)
    expect(previewAlignmentAfterEditorScroll.headingOffset).toBeLessThan(120)

    const editorTopAfterPreviewScroll = await page.evaluate(async () => {
      const editor = document.querySelector<HTMLElement>('.markdown-edit-workbench .cm-scroller')
      const preview = document.querySelector<HTMLElement>('.markdown-workbench-preview-pane .preview')
      if (!editor || !preview) throw new Error('missing editor or preview scroller')
      const before = editor.scrollTop
      preview.scrollTop = 0
      preview.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => setTimeout(resolve, 500))
      return { before, after: editor.scrollTop }
    })
    expect(editorTopAfterPreviewScroll.after).toBeLessThan(editorTopAfterPreviewScroll.before)
  })

  test('存在未保存草稿时切换文件需要确认', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()

    const previewParagraph = page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })
    await previewParagraph.fill('Unsaved before switching')

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('当前文档有未保存编辑草稿')
      await dialog.dismiss()
    })
    await page.click('.file-tree-row.file:has-text("test2.md")')
    await expect(page.getByLabel('test1.md 编辑工作区')).toBeVisible()
    await expect(page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Unsaved before switching',
    })).toBeVisible()

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('当前文档有未保存编辑草稿')
      await dialog.accept()
    })
    await page.click('.file-tree-row.file:has-text("test2.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 2')
  })

  test('分屏模式下可在目标面板进入编辑并更新草稿预览', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await page.keyboard.press('Control+\\')
    await expect(page.locator('.split-leaf-panel')).toHaveCount(2)

    const testPanel = page.locator('.split-leaf-panel', { hasText: 'test1.md' }).first()
    await expect(testPanel).toBeVisible()

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'), 'panel-1')
    await expect(testPanel.getByLabel('test1.md 编辑工作区')).toBeVisible()
    await expect(testPanel.getByRole('tab', { name: '对照预览' })).toHaveAttribute('aria-selected', 'true')

    const previewParagraph = testPanel.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: 'Hello World',
    })
    await previewParagraph.fill('Split rendered edit')
    await testPanel.locator('.markdown-workbench-preview-status').click()
    await expect(testPanel.locator('.markdown-workbench-preview-pane p', {
      hasText: 'Split rendered edit',
    })).toBeVisible()
    await expect(testPanel.getByText('草稿预览，未保存到磁盘')).toBeVisible()
  })
})
