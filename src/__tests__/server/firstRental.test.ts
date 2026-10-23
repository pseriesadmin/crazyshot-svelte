import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isFirstRentalUser } from '$lib/server/coupons/firstRental'

describe('첫 렌탈 판정 — 레거시 구매 이력 포함 (Migration 751)', () => {
  it('예약 0건 + 레거시 구매 0/null → 첫 렌탈', () => {
    expect(isFirstRentalUser(0, 0)).toBe(true)
    expect(isFirstRentalUser(0, null)).toBe(true)
    expect(isFirstRentalUser(0, undefined)).toBe(true)
  })
  it('레거시 구매 1건 이상이면 첫 렌탈 아님', () => {
    expect(isFirstRentalUser(0, 1)).toBe(false)
    expect(isFirstRentalUser(0, 7)).toBe(false)
  })
  it('크레이지샷 예약 이력이 있으면 첫 렌탈 아님', () => {
    expect(isFirstRentalUser(1, 0)).toBe(false)
  })
  it('장바구니·계약서·자격검증 세 곳이 공용 규칙을 쓴다(소스 점검)', () => {
    const sources: Record<string, string> = {
      'src/routes/cart/+page.server.ts': readFileSync('src/routes/cart/+page.server.ts', 'utf8'),
      'src/routes/contract/[token]/+page.server.ts': readFileSync('src/routes/contract/[token]/+page.server.ts', 'utf8'),
      'src/lib/server/coupons/couponEligibility.ts': readFileSync('src/lib/server/coupons/couponEligibility.ts', 'utf8'),
    }
    for (const [f, src] of Object.entries(sources)) {
      expect(src, f).toContain('isFirstRentalUser(')
      expect(src, f).toContain('legacy_purchase_count')
    }
  })
})
