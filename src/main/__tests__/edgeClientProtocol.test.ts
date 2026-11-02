import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MsEdgeTTS } from 'msedge-tts'

// 验证真实依赖生成的握手，不请求远端；旧 v1 客户端不能通过此契约。
const client = MsEdgeTTS as unknown as { getSynthUrl(): Promise<string> }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Edge 客户端握手协议', () => {
  it('固定连接到 Edge 服务并生成独立请求标识', async () => {
    const first = new URL(await client.getSynthUrl())
    const second = new URL(await client.getSynthUrl())

    expect(first.protocol).toBe('wss:')
    expect(first.hostname).toBe('speech.platform.bing.com')
    expect(first.pathname).toBe('/consumer/speech/synthesize/readaloud/edge/v1')
    expect(first.username).toBe('')
    expect(first.password).toBe('')
    expect(first.searchParams.get('ConnectionId')).toMatch(/^[a-f0-9-]{36}$/)
    expect(second.searchParams.get('ConnectionId')).not.toBe(first.searchParams.get('ConnectionId'))
  })

  it('使用 v2 握手版本和 CS64-SHA256 令牌格式', async () => {
    const url = new URL(await client.getSynthUrl())

    expect(url.searchParams.get('Sec-MS-GEC-Version')).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/)
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[A-F0-9]{16}-[A-F0-9]{64}$/)
  })

  it('按五分钟时间窗计算带版权前缀的 v2 摘要', async () => {
    const now = 1793455200000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const first = new URL(await client.getSynthUrl())
    clock.mockReturnValue(now + 1000)
    const second = new URL(await client.getSynthUrl())
    const seconds = Math.floor(now / 1000) + 11644473600
    const ticks = (seconds - seconds % 300) * 10000000
    const input = `Copyright (C) Microsoft Corporation. All rights reserved.${ticks}${first.searchParams.get('TrustedClientToken')}`
    const digest = createHash('sha256').update(input).digest('hex').toUpperCase()

    expect(first.searchParams.get('Sec-MS-GEC')?.split('-')[1]).toBe(digest)
    expect(second.searchParams.get('Sec-MS-GEC')).toBe(first.searchParams.get('Sec-MS-GEC'))
    clock.mockReturnValue(now + 300000)
    const next = new URL(await client.getSynthUrl())
    expect(next.searchParams.get('Sec-MS-GEC')).not.toBe(first.searchParams.get('Sec-MS-GEC'))
  })
})
