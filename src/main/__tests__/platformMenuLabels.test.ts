import { describe, expect, it } from 'vitest'
import { getFileManagerLabels } from '../platformMenuLabels'

describe('getFileManagerLabels', () => {
  it.each([
    ['darwin', '在 Finder 中显示', 'Finder'],
    ['win32', '在文件资源管理器中显示', '文件资源管理器'],
    ['linux', '在文件管理器中显示', '文件管理器'],
  ] as const)('为 %s 返回对应系统文案', (platform, showInFolder, fileManagerName) => {
    expect(getFileManagerLabels(platform)).toEqual({ showInFolder, fileManagerName })
  })
})
