import { beforeEach, describe, expect, it } from 'vitest'
import { useFileStore } from '../../src/stores/fileStore'

describe('fileStore', () => {
  beforeEach(() => {
    useFileStore.setState({
      folderPath: null,
      files: [],
      isLoading: false,
      selectedPaths: new Set()
    })
  })

  it('切换文件夹时应清空旧文件夹的多选状态', () => {
    useFileStore.setState({
      folderPath: '/folders/A',
      selectedPaths: new Set(['/folders/A/one.md', '/folders/A/two.md'])
    })

    useFileStore.getState().setFolderPath('/folders/B')

    expect(useFileStore.getState().folderPath).toBe('/folders/B')
    expect(useFileStore.getState().selectedPaths).toEqual(new Set())
  })
})
