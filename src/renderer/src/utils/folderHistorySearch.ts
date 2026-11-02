export interface FolderSearchItem {
  id: string
  name: string
  path: string
}

export interface PinyinCharacter {
  origin: string
  isZh: boolean
  result: string
}

interface PinyinSegment {
  atStart: boolean
  text: string
  boundaries: number[]
}

export interface FolderNamePinyinIndex {
  allChinese: boolean
  segments: PinyinSegment[]
}

export interface FolderPinyinQuery {
  text: string
  separators: number[]
}

export function parseFolderPinyinQuery(query: string): FolderPinyinQuery | null {
  const normalized = query.trim().toLowerCase().replaceAll('ü', 'v')
  if (!/^[a-z]+(?:[ ']+[a-z]+)*$/.test(normalized)) return null
  const words = normalized.split(/[ ']+/)
  const text = words.join('')
  if (text.length < 3) return null
  const separators: number[] = []
  let offset = 0
  for (const word of words.slice(0, -1)) {
    offset += word.length
    separators.push(offset)
  }
  return { text, separators }
}

export function buildFolderNamePinyinIndex(parts: PinyinCharacter[]): FolderNamePinyinIndex {
  const segments: PinyinSegment[] = []
  let segment: PinyinSegment | null = null
  let allChinese = parts.length > 0
  for (const [index, part] of parts.entries()) {
    if (!part.isZh || !/^[a-z]+$/.test(part.result)) {
      allChinese = false
      segment = null
      continue
    }
    if (!segment) {
      segment = { atStart: index === 0, text: '', boundaries: [0] }
      segments.push(segment)
    }
    segment.text += part.result
    segment.boundaries.push(segment.text.length)
  }
  return { allChinese, segments }
}

export function folderPinyinMatchRank(index: FolderNamePinyinIndex, query: FolderPinyinQuery): number | null {
  let rank: number | null = null
  for (const segment of index.segments) {
    if (segment.atStart && segment.text.startsWith(query.text)
      && query.separators.every(offset => segment.boundaries.includes(offset))) {
      rank = rank === null ? 3 : Math.min(rank, 3)
    }
    if (query.text.length < 4) continue
    for (let start = 0; start < segment.boundaries.length - 2; start++) {
      const from = segment.boundaries[start]
      const to = from + query.text.length
      const end = segment.boundaries.indexOf(to, start + 2)
      if (end < 0 || segment.text.slice(from, to) !== query.text) continue
      if (!query.separators.every(offset => segment.boundaries.includes(from + offset))) continue
      const candidateRank = index.allChinese && from === 0 && to === segment.text.length
        ? 0
        : segment.atStart && from === 0 ? 1 : 2
      rank = rank === null ? candidateRank : Math.min(rank, candidateRank)
    }
  }
  return rank
}

export function matchFolderHistoryPinyin<T extends FolderSearchItem>(
  history: T[],
  directMatches: T[],
  query: FolderPinyinQuery,
  indexes: ReadonlyMap<string, FolderNamePinyinIndex>,
): T[] {
  const seen = new Set(directMatches.map(item => item.path))
  const matches: { item: T; rank: number }[] = []
  for (const item of history) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    const index = indexes.get(item.name)
    const rank = index ? folderPinyinMatchRank(index, query) : null
    if (rank !== null) matches.push({ item, rank })
  }
  return matches.sort((a, b) => a.rank - b.rank).map(match => match.item)
}
