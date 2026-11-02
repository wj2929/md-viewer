import {
  classifyWikiResource,
  parseLocalMediaDimensions,
  parseMediaTimeFragment,
  type LocalMediaDimensions,
  type MediaTimeFragment,
} from '../localMedia'

export type WikiResourceKind = ReturnType<typeof classifyWikiResource>
export type WikiFragmentKind = 'heading' | 'block' | 'media-time' | 'pdf-page' | 'pdf-height' | 'other'

export interface ParsedWikiReference {
  isEmbed: boolean
  raw: string
  rawTarget: string
  path: string
  pipe?: string
  resourceKind: WikiResourceKind
  fragment?: string
  fragmentKind?: WikiFragmentKind
  mediaTime?: MediaTimeFragment
  dimensions?: LocalMediaDimensions
  displayText: string
}

export interface ParsedWikiReferenceAt {
  reference: ParsedWikiReference
  start: number
  end: number
  destinationStart: number
  destinationEnd: number
}

export function parseWikiReferenceAt(
  source: string,
  start: number,
): ParsedWikiReferenceAt | null {
  const isEmbed = source.startsWith('![[', start)
  const openerLength = isEmbed ? 3 : source.startsWith('[[', start) ? 2 : 0
  if (
    !openerLength
    || isEscaped(source, start)
    || (!isEmbed && source[start - 1] === '!' && isEscaped(source, start - 1))
  ) return null

  const contentStart = start + openerLength
  const close = source.indexOf(']]', contentStart)
  if (close < 0) return null
  const content = source.slice(contentStart, close)
  if (!content || /[\r\n]|\[\[/.test(content)) return null

  const pipeIndex = content.indexOf('|')
  const targetContent = pipeIndex >= 0 ? content.slice(0, pipeIndex) : content
  const leadingTargetWhitespace = targetContent.length - targetContent.trimStart().length
  const rawTarget = targetContent.trim()
  const pipe = pipeIndex >= 0 ? content.slice(pipeIndex + 1).trim() : undefined
  if (!rawTarget || rawTarget.includes('|')) return null

  const hashIndex = rawTarget.indexOf('#')
  const rawPath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget
  const leadingPathWhitespace = rawPath.length - rawPath.trimStart().length
  const path = rawPath.trim()
  const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1).trim() : undefined
  if (!path && (!fragment || isEmbed)) return null

  const resourceKind = classifyWikiResource(path)
  const fragmentDetails = classifyFragment(resourceKind, fragment)
  const dimensions = isEmbed && (resourceKind === 'image' || resourceKind === 'video')
    ? parseLocalMediaDimensions(pipe)
    : null
  const fallbackName = path.split(/[\\/]/).filter(Boolean).pop() || path || fragment || '链接'
  const displayText = pipe && !dimensions ? pipe : fallbackName

  return {
    reference: {
      isEmbed,
      raw: source.slice(start, close + 2),
      rawTarget,
      path,
      ...(pipe === undefined ? {} : { pipe }),
      resourceKind,
      ...(fragment ? { fragment } : {}),
      ...fragmentDetails,
      ...(dimensions ? { dimensions } : {}),
      displayText,
    },
    start,
    end: close + 2,
    destinationStart: contentStart + leadingTargetWhitespace + leadingPathWhitespace,
    destinationEnd: contentStart + leadingTargetWhitespace + leadingPathWhitespace + path.length,
  }
}

function classifyFragment(
  resourceKind: WikiResourceKind,
  fragment?: string,
): Pick<ParsedWikiReference, 'fragmentKind' | 'mediaTime'> {
  if (!fragment) return {}
  if (resourceKind === 'audio' || resourceKind === 'video') {
    const mediaTime = parseMediaTimeFragment(fragment)
    return mediaTime
      ? { fragmentKind: 'media-time', mediaTime }
      : { fragmentKind: 'other' }
  }
  if (resourceKind === 'markdown') {
    return { fragmentKind: fragment.startsWith('^') ? 'block' : 'heading' }
  }
  if (resourceKind === 'document') {
    if (/^page=\d+$/i.test(fragment)) return { fragmentKind: 'pdf-page' }
    if (/^height=\d+$/i.test(fragment)) return { fragmentKind: 'pdf-height' }
  }
  return { fragmentKind: 'other' }
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}
