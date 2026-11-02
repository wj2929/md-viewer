import { describe, expect, it } from 'vitest'
import { indexFolderName } from '../../src/utils/folderNamePinyin'
import { folderPinyinMatchRank, matchFolderHistoryPinyin, parseFolderPinyinQuery } from '../../src/utils/folderHistorySearch'

const rank = (name: string, query: string): number | null => {
  const parsed = parseFolderPinyinQuery(query)
  return parsed ? folderPinyinMatchRank(indexFolderName(name), parsed) : null
}

describe('目录拼音完整音节及名称前缀', () => {
  it.each([
    ['研发中心', 'yanfa', 1], ['研发中心', 'YAN FA', 1],
    ['研发中心', 'zhongxin', 2], ['培训中心', 'zhongxin', 2],
    ['研发', 'yanfa', 0], ['材料研发归档', 'yanfa', 2],
    ['重庆项目', 'chongqing', 1], ['重庆项目', 'zhongqing', null],
    ['银行资料', 'yinhang', 1], ['旅游资料', 'lvyou', 1], ['旅游资料', 'lüyou', 1],
    ['西安', "xi'an", 0], ['西安', "x'ian", null],
    ['研发中心', 'anfa', null], ['研发中心', 'yanf', 3],
    ['研发中心', 'yf', null], ['研发中心', 'yanfax', null], ['研发中心', 'yanxin', null],
    ['研发-AI-平台', 'yanfapingtai', null], ['研发-AI-平台', 'yanfa', 1],
    ['研发2026平台', 'yanfapingtai', null], ['研发𰻞平台', 'yanfapingtai', null],
    ['研发鿿平台', 'yanfapingtai', null], ['研𰻞发', 'yanfa', null],
    ['直播平台', 'boping', 2], ['研发中心', 'zhong', null], ['双', 'shuang', 3],
    ['研发中心', 'yan', 3], ['研发中心', 'YAN F', 3],
    ['重庆项目', 'cho', 3], ['重庆项目', 'chongq', 3],
    ['银行资料', 'yin', 3], ['银行资料', 'yinh', 3],
    ['中心资料', 'zhong', 3], ['中心资料', 'zho', 3],
    ['旅游资料', 'lvy', 3], ['旅游资料', 'LÜ Y', 3],
    ['研发中心', 'ya', null], ['旅游资料', 'lv', null], ['研发中心', 'abc', null],
    ['研发项目', 'yanfax', 3], ['研发中心', 'yanfazq', null],
    ['材料研发归档', 'yanf', null], ['A研发中心', 'yanf', null],
    ['2026研发中心', 'yan', null], ['研发中心', 'y an', null],
    ['重庆项目', 'cho ngq', null], ['研-发', 'yanf', null],
    ['研发-AI-平台', 'yanfap', null], ['研发2026平台', 'yanfap', null],
    ['阿姨', 'ayi', 3],
    ['A研发中心', 'yanfa', 2], ['研发2026', 'yanfa', 1], ['研-发', 'yanfa', null],
  ])('%s / %s => %s', (name, query, expected) => {
    expect(rank(name, query)).toBe(expected)
  })

  it.each(['', 'a', 'yf', 'ya', 'yan-fa', '/yanfa', 'yanfa2', '研发', 'yánfa', 'yan\tfa', "'yanfa", "yanfa'"])
    ('不把 %s 归一化成拼音候选查询', query => {
      expect(parseFolderPinyinQuery(query)).toBeNull()
    })

  it('只排序拼音组，先全名再前缀再内部，同层保留历史順序', () => {
    const names = ['材料研发归档', '研发中心', '研发资料', '研发', '联合研发', '研发']
    const history = names.map((name, i) => ({ id: `h${i}`, name, path: `/fixture/${i}/${name}` }))
    const indexes = new Map(names.map(name => [name, indexFolderName(name)]))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yanfa')!, indexes).map(item => item.id))
      .toEqual(['h3', 'h5', 'h1', 'h2', 'h0', 'h4'])
  })

  it('三字母前缀可解析，完整匹配排在未完成名称前缀前，同层历史顺序不变', () => {
    expect(parseFolderPinyinQuery('YAN')).toEqual({ text: 'yan', separators: [] })
    const names = ['盐房资料', '材料研发', '研发中心', '研发', '盐方', 'yanfa-tools']
    const history = names.map((name, i) => ({ id: `h${i}`, name, path: `/fixture/${i}` }))
    const indexes = new Map(names.map(name => [name, indexFolderName(name)]))
    expect(matchFolderHistoryPinyin(history, [history[5]], parseFolderPinyinQuery('yanfa')!, indexes).map(item => item.id))
      .toEqual(['h3', 'h2', 'h1', 'h0', 'h4'])
    expect(matchFolderHistoryPinyin(history, [history[5]], parseFolderPinyinQuery('yan')!, indexes).map(item => item.id))
      .toEqual(['h0', 'h2', 'h3', 'h4'])
  })

  it('不转写祖先路径，原文命中不重复，按精确path去重', () => {
    const history = [
      { id: 'ancestor', name: '资料', path: '/工作资料/资料' },
      { id: 'first', name: '研发', path: '/same/研发' },
      { id: 'duplicate', name: '研发', path: '/same/研发' },
      { id: 'other', name: '研发', path: '/other/研发' },
    ]
    const indexes = new Map(history.map(item => [item.name, indexFolderName(item.name)]))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('gongzuo')!, indexes)).toEqual([])
    expect(matchFolderHistoryPinyin(history, [history[1]], parseFolderPinyinQuery('yanfa')!, indexes))
      .toEqual([history[3]])
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yanfa')!, indexes))
      .toEqual([history[1], history[3]])
  })

  it('完整返回第6个候选，固定60个不同名称不跨片段扩散', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      id: `h${i}`, path: `/fixture/${i}`, name: i < 6 ? `研发中心${i}` : i % 2 ? `研-AI-发${i}` : `docs${i}`,
    }))
    const indexes = new Map(history.map(item => [item.name, indexFolderName(item.name)]))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yanfazhongxin')!, indexes))
      .toEqual(history.slice(0, 6))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yanfa')!, indexes))
      .toEqual(history.slice(0, 6))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yanf')!, indexes))
      .toEqual(history.slice(0, 6))
    expect(matchFolderHistoryPinyin(history, [], parseFolderPinyinQuery('yan')!, indexes))
      .toEqual(history.filter((_, i) => i < 6 || i % 2 === 1))
  })
})
