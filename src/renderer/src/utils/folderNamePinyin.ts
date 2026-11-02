import { pinyin } from 'pinyin-pro'
import { buildFolderNamePinyinIndex, type FolderNamePinyinIndex } from './folderHistorySearch'

export function indexFolderName(name: string): FolderNamePinyinIndex {
  return buildFolderNamePinyinIndex(pinyin(name, {
    toneType: 'none',
    type: 'all',
    multiple: false,
    v: true,
  }))
}
