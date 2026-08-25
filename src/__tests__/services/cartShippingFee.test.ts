/**
 * TDD-RED: cartShippingFee.test.ts
 * 왕복요금/반납요금 — 카트 전체 기준 최대 1회 부과 로직 검증
 * (TASK.md Q5 2026-08-25 Stephen 확정)
 *
 * 테스트 전략:
 *   - 순수 함수 단위 테스트 (DB 연동 없음)
 *   - calcRoundTripFee / calcReturnFee 각각 독립 검증
 *   - 핵심 케이스: 1상품, 3상품(곱연산 금지), 플래그 false 전체미적용, enable=false
 */

import { describe, it, expect } from 'vitest'
import { calcRoundTripFee, calcReturnFee } from '$lib/utils/cartShippingFee'

// ── 테스트용 기본 배송 설정 ───────────────────────────────────────────────────
const SHIPPING_ON = {
  enable_round_trip: true,
  round_trip_fee: 5000,
  enable_return: true,
  return_fee: 2000,
}

// ── 단일 아이템 헬퍼 ─────────────────────────────────────────────────────────
function makeItem(opts: {
  pickupIsDelivery: boolean
  returnIsDelivery: boolean
  shipping_round_trip?: boolean | null
  shipping_return?: boolean | null
}) {
  return {
    pickupIsDelivery:   opts.pickupIsDelivery,
    returnIsDelivery:   opts.returnIsDelivery,
    shipping_round_trip: opts.shipping_round_trip ?? true,
    shipping_return:     opts.shipping_return     ?? true,
  }
}

// ════════════════════════════════════════════════════════════════════
describe('calcRoundTripFee — 왕복요금 카트 1회 부과', () => {
  it('단일 상품 배송픽업 → 왕복요금 1회', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcRoundTripFee(SHIPPING_ON, items)).toBe(5000)
  })

  it('상품 3개 모두 배송픽업 → 왕복요금 여전히 1회 (곱연산 절대 금지)', () => {
    const item = makeItem({ pickupIsDelivery: true, returnIsDelivery: false })
    expect(calcRoundTripFee(SHIPPING_ON, [item, item, item])).toBe(5000)
  })

  it('enable_round_trip=false → 0', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcRoundTripFee({ ...SHIPPING_ON, enable_round_trip: false }, items)).toBe(0)
  })

  it('pickup 방식이 배송 아님 → 0', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: false })]
    expect(calcRoundTripFee(SHIPPING_ON, items)).toBe(0)
  })

  it('상품 플래그 하나라도 false → 전체 미적용(0) [보수적 처리]', () => {
    const items = [
      makeItem({ pickupIsDelivery: true, returnIsDelivery: false, shipping_round_trip: true }),
      makeItem({ pickupIsDelivery: true, returnIsDelivery: false, shipping_round_trip: false }),
    ]
    expect(calcRoundTripFee(SHIPPING_ON, items)).toBe(0)
  })

  it('체크된 아이템 없음 → 0', () => {
    expect(calcRoundTripFee(SHIPPING_ON, [])).toBe(0)
  })

  it('shippingSettings null → 0', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcRoundTripFee(null, items)).toBe(0)
  })

  it('round_trip_fee=null 이어도 enable=true + 조건 충족 → 0 (null-safe)', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcRoundTripFee({ ...SHIPPING_ON, round_trip_fee: null }, items)).toBe(0)
  })

  it('하나라도 pickup=배송이면 나머지 방문이어도 트리거 (OR 조건)', () => {
    const items = [
      makeItem({ pickupIsDelivery: false, returnIsDelivery: false }),
      makeItem({ pickupIsDelivery: true,  returnIsDelivery: false }),
    ]
    expect(calcRoundTripFee(SHIPPING_ON, items)).toBe(5000)
  })
})

// ════════════════════════════════════════════════════════════════════
describe('calcReturnFee — 반납요금 카트 1회 부과', () => {
  it('단일 상품 배송반납 → 반납요금 1회', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })]
    expect(calcReturnFee(SHIPPING_ON, items)).toBe(2000)
  })

  it('상품 3개 모두 배송반납 → 반납요금 여전히 1회 (곱연산 절대 금지)', () => {
    const item = makeItem({ pickupIsDelivery: false, returnIsDelivery: true })
    expect(calcReturnFee(SHIPPING_ON, [item, item, item])).toBe(2000)
  })

  it('enable_return=false → 0', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })]
    expect(calcReturnFee({ ...SHIPPING_ON, enable_return: false }, items)).toBe(0)
  })

  it('return 방식이 배송 아님 → 0', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: false })]
    expect(calcReturnFee(SHIPPING_ON, items)).toBe(0)
  })

  it('상품 플래그 하나라도 false → 전체 미적용(0)', () => {
    const items = [
      makeItem({ pickupIsDelivery: false, returnIsDelivery: true, shipping_return: true }),
      makeItem({ pickupIsDelivery: false, returnIsDelivery: true, shipping_return: false }),
    ]
    expect(calcReturnFee(SHIPPING_ON, items)).toBe(0)
  })

  it('수령+반납 둘 다 배송 → calcReturnFee는 반납요금(2000)만 반환', () => {
    const item = makeItem({ pickupIsDelivery: true, returnIsDelivery: true })
    expect(calcReturnFee(SHIPPING_ON, [item])).toBe(2000)
  })

  it('수령+반납 둘 다 배송 → calcRoundTripFee는 왕복요금(5000)만 반환 (독립 판정)', () => {
    const item = makeItem({ pickupIsDelivery: true, returnIsDelivery: true })
    expect(calcRoundTripFee(SHIPPING_ON, [item])).toBe(5000)
    // 합산: 5000 + 2000 = 7000 (otDeliveryFee에서 처리)
  })

  it('shipping_round_trip 플래그와 shipping_return 플래그는 서로 독립', () => {
    const item = makeItem({ pickupIsDelivery: true, returnIsDelivery: true, shipping_round_trip: false, shipping_return: true })
    // 왕복 플래그 false → 왕복요금 0
    expect(calcRoundTripFee(SHIPPING_ON, [item])).toBe(0)
    // 반납 플래그 true → 반납요금 2000
    expect(calcReturnFee(SHIPPING_ON, [item])).toBe(2000)
  })
})
