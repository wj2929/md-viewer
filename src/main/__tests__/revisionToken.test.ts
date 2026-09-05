import { describe, expect, it } from 'vitest'
import {
  buildFullSha256Revision,
  isFullSha256Revision,
  parseFullSha256Revision,
  sha256Hex,
} from '../revisionToken'

describe('full SHA-256 revision token', () => {
  it('生成完整、稳定的小写 SHA-256 token', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(buildFullSha256Revision('abc')).toBe(
      'v2:full-sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('按原始 UTF-8 bytes 区分 Unicode、EOL 和规范化形式', () => {
    expect(buildFullSha256Revision('中文😀\r\n')).not.toBe(buildFullSha256Revision('中文😀\n'))
    expect(buildFullSha256Revision('é')).not.toBe(buildFullSha256Revision('é'))
    expect(buildFullSha256Revision(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])))
      .not.toBe(buildFullSha256Revision('a'))
  })

  it('严格解析 v2 full SHA-256，不接受 legacy 或格式漂移', () => {
    const valid = buildFullSha256Revision('content')
    expect(parseFullSha256Revision(valid)).toHaveLength(64)
    expect(isFullSha256Revision(valid)).toBe(true)

    for (const invalid of [
      '1000:12',
      '1000:12:327f031b25e00b1a',
      'v2:full-sha256:',
      'v2:full-sha256:ABCDEF'.padEnd(79, '0'),
      'v2:full-sha256:abc',
      `${valid}:extra`,
    ]) {
      expect(parseFullSha256Revision(invalid)).toBeNull()
      expect(isFullSha256Revision(invalid)).toBe(false)
    }
  })

  it('单字节变化生成不同 token', () => {
    expect(buildFullSha256Revision('content-a')).not.toBe(buildFullSha256Revision('content-b'))
  })
})
