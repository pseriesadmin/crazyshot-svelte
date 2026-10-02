import { describe, it, expect } from 'vitest'
import { userCouponUsedCount, isUserCouponExhausted, parsePerUserLimit } from '$lib/utils/couponUsage'

/**
 * 쿠폰 "1인당 사용 횟수" 판정 — 사용자 보유 쿠폰(user_coupons 1행)의 사용 횟수·소진 여부.
 * 정책(Stephen 확정, 2026-10-02): 0 = 무제한(소진 없음, 매번 노출), N = N번 사용하면 장바구니 목록에서 제외.
 * 서버 정본: private._validate_and_consume_coupon(Migration 623) — 같은 규칙.
 */
describe('userCouponUsedCount', () => {
  it('한 번도 안 썼으면 0', () => {
    expect(userCouponUsedCount(null, 0)).toBe(0)
    expect(userCouponUsedCount(undefined, undefined)).toBe(0)
  })
  it('used_at이 있으면 used_count를 그대로 쓴다', () => {
    expect(userCouponUsedCount('2026-10-01T00:00:00Z', 3)).toBe(3)
  })
  it('used_at은 있는데 used_count가 0/NULL인 과거 데이터는 1회로 본다', () => {
    expect(userCouponUsedCount('2026-10-01T00:00:00Z', 0)).toBe(1)
    expect(userCouponUsedCount('2026-10-01T00:00:00Z', null)).toBe(1)
  })
})

describe('isUserCouponExhausted', () => {
  const used = '2026-10-01T00:00:00Z'
  it('안 쓴 쿠폰은 한도와 무관하게 소진 아님', () => {
    expect(isUserCouponExhausted(null, 0, 1)).toBe(false)
    expect(isUserCouponExhausted(null, 0, 0)).toBe(false)
  })
  it('1인당 1회(기본) — 한 번 쓰면 소진', () => {
    expect(isUserCouponExhausted(used, 1, 1)).toBe(true)
    expect(isUserCouponExhausted(used, 0, 1)).toBe(true) // 과거 데이터(used_count 0)도 1회로 취급
  })
  it('N회 — N번째 사용 후에만 소진', () => {
    expect(isUserCouponExhausted(used, 1, 3)).toBe(false)
    expect(isUserCouponExhausted(used, 2, 3)).toBe(false)
    expect(isUserCouponExhausted(used, 3, 3)).toBe(true)
    expect(isUserCouponExhausted(used, 4, 3)).toBe(true)
  })
  it('0 = 무제한 — 몇 번을 써도 소진 아님', () => {
    expect(isUserCouponExhausted(used, 1, 0)).toBe(false)
    expect(isUserCouponExhausted(used, 9999, 0)).toBe(false)
  })
  it('한도 미설정(NULL)은 과거 기본값 1회로 취급', () => {
    expect(isUserCouponExhausted(used, 1, null)).toBe(true)
    expect(isUserCouponExhausted(null, 0, null)).toBe(false)
  })
})

describe('parsePerUserLimit — CMS 폼 입력 정규화', () => {
  it('빈 값·공백·미전달·숫자 아님은 기본 1회(실수로 무제한이 되지 않게)', () => {
    expect(parsePerUserLimit('')).toBe(1)
    expect(parsePerUserLimit('   ')).toBe(1)
    expect(parsePerUserLimit(null)).toBe(1)
    expect(parsePerUserLimit(undefined)).toBe(1)
    expect(parsePerUserLimit('abc')).toBe(1)
  })
  it('0은 명시적으로 입력했을 때만 무제한', () => {
    expect(parsePerUserLimit('0')).toBe(0)
    expect(parsePerUserLimit(0)).toBe(0)
  })
  it('양의 정수는 그대로, 소수는 내림, 음수는 0', () => {
    expect(parsePerUserLimit('3')).toBe(3)
    expect(parsePerUserLimit('1000')).toBe(1000)
    expect(parsePerUserLimit('2.9')).toBe(2)
    expect(parsePerUserLimit('-5')).toBe(0)
  })
})
