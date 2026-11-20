// 문자 접두어 중복 방지 (2026-11-16)
import { describe, it, expect } from 'vitest'
import { withSmsPrefix, SMS_BRAND_PREFIX } from '$lib/utils/notifyTemplate'

describe('withSmsPrefix', () => {
  it('접두어가 없으면 붙인다', () => {
    expect(withSmsPrefix('반납 안내')).toBe(`${SMS_BRAND_PREFIX}반납 안내`)
  })
  it('이미 [크레이지샷] 으로 시작하면 중복해 붙이지 않는다', () => {
    expect(withSmsPrefix('[크레이지샷] 반납 전 안내')).toBe('[크레이지샷] 반납 전 안내')
  })
  it('앞 공백이 있어도 중복해 붙이지 않는다', () => {
    expect(withSmsPrefix('  [크레이지샷] 반납')).toBe('[크레이지샷] 반납')
  })
  it('[크레이지배송] 같은 다른 머리말은 접두어를 붙인다', () => {
    expect(withSmsPrefix('[크레이지배송] 반납 안내')).toBe(`${SMS_BRAND_PREFIX}[크레이지배송] 반납 안내`)
  })
})
