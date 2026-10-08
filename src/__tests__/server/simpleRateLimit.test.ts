import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '$lib/server/simpleRateLimit'

describe('createRateLimiter — 슬라이딩 윈도우', () => {
  it('한도까지 허용하고 초과는 거부하며, 창이 지나면 다시 허용한다', () => {
    let t = 0
    const l = createRateLimiter(3, 1000, () => t)
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('a')]).toEqual([true, true, true, false])
    t = 999
    expect(l.allow('a')).toBe(false)
    t = 1001
    expect(l.allow('a')).toBe(true)
  })

  it('키(IP)별로 따로 센다', () => {
    const l = createRateLimiter(1, 1000, () => 0)
    expect(l.allow('a')).toBe(true)
    expect(l.allow('b')).toBe(true)
    expect(l.allow('a')).toBe(false)
  })
})
