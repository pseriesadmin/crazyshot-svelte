import { describe, it, expect } from 'vitest'
import {
  DEFAULT_POINT_USE_RULES,
  parsePointUseRules,
  normalizePointUse,
  maxUsablePoints,
  describePointUseRules,
  type PointUseRules,
} from '$lib/utils/pointUseRules'

const rules = (o: Partial<PointUseRules> = {}): PointUseRules => ({ ...DEFAULT_POINT_USE_RULES, ...o })

describe('normalizePointUse — 서버 normalize_point_use와 같은 순서', () => {
  it('기본 규칙: 보유 포인트와 결제금액 중 작은 값까지(현행 동작)', () => {
    expect(normalizePointUse(rules(), { requested: 3000, balance: 5000, payable: 20000 })).toBe(3000)
    expect(normalizePointUse(rules(), { requested: 9000, balance: 5000, payable: 20000 })).toBe(5000)
    expect(normalizePointUse(rules(), { requested: 90000, balance: 50000, payable: 20000 })).toBe(20000)
  })

  it('사용 OFF면 0', () => {
    expect(normalizePointUse(rules({ useEnabled: false }), { requested: 3000, balance: 5000, payable: 20000 })).toBe(0)
  })

  it('최대 비율: 결제금액의 N%까지', () => {
    expect(normalizePointUse(rules({ maxUseRatio: 50 }), { requested: 99999, balance: 99999, payable: 20000 })).toBe(10000)
    expect(normalizePointUse(rules({ maxUseRatio: 0 }), { requested: 3000, balance: 5000, payable: 20000 })).toBe(0)
  })

  it('사용 단위: 단위 배수로 내림', () => {
    expect(normalizePointUse(rules({ useUnit: 100 }), { requested: 1234, balance: 5000, payable: 20000 })).toBe(1200)
    expect(normalizePointUse(rules({ useUnit: 100 }), { requested: 99, balance: 5000, payable: 20000 })).toBe(0)
  })

  it('최소 사용 포인트: 미만이면 0, 이상이면 그대로', () => {
    expect(normalizePointUse(rules({ minUsePoints: 1000 }), { requested: 500, balance: 5000, payable: 20000 })).toBe(0)
    expect(normalizePointUse(rules({ minUsePoints: 1000 }), { requested: 1000, balance: 5000, payable: 20000 })).toBe(1000)
  })

  it('적용 순서: 비율 상한 → 단위 내림 → 최소 판정', () => {
    // payable 10050 × 50% = 5025 → 단위 1000 내림 = 5000 → 최소 5000 이상이라 통과
    expect(normalizePointUse(rules({ maxUseRatio: 50, useUnit: 1000, minUsePoints: 5000 }), { requested: 99999, balance: 99999, payable: 10050 })).toBe(5000)
    // 같은 조건에서 최소가 6000이면 0
    expect(normalizePointUse(rules({ maxUseRatio: 50, useUnit: 1000, minUsePoints: 6000 }), { requested: 99999, balance: 99999, payable: 10050 })).toBe(0)
  })

  it('이상 입력은 0으로 안전 처리', () => {
    expect(normalizePointUse(rules(), { requested: -5, balance: 5000, payable: 20000 })).toBe(0)
    expect(normalizePointUse(rules(), { requested: NaN, balance: 5000, payable: 20000 })).toBe(0)
    expect(normalizePointUse(rules(), { requested: 100, balance: 0, payable: 20000 })).toBe(0)
    expect(normalizePointUse(rules(), { requested: 100, balance: 5000, payable: -1 })).toBe(0)
  })
})

describe('maxUsablePoints·parsePointUseRules·describePointUseRules', () => {
  it('maxUsablePoints: 요청량 무제한 기준의 최대치', () => {
    expect(maxUsablePoints(rules({ useUnit: 500 }), 7300, 20000)).toBe(7000)
  })

  it('parsePointUseRules: 비정상 응답은 기본값·범위로 보정', () => {
    expect(parsePointUseRules(null)).toEqual(DEFAULT_POINT_USE_RULES)
    expect(parsePointUseRules({ use_enabled: false, min_use_points: -5, use_unit: 0, max_use_ratio: 250 }))
      .toEqual({ useEnabled: false, minUsePoints: 0, useUnit: 1, maxUseRatio: 100 })
    expect(parsePointUseRules({ use_enabled: true, min_use_points: 1000, use_unit: 100, max_use_ratio: 50 }))
      .toEqual({ useEnabled: true, minUsePoints: 1000, useUnit: 100, maxUseRatio: 50 })
  })

  it('describePointUseRules: 해당 규칙만 안내, 기본값이면 안내 없음, OFF면 사용 불가 안내', () => {
    expect(describePointUseRules(rules())).toEqual([])
    expect(describePointUseRules(rules({ useEnabled: false }))).toEqual(['현재 포인트를 사용할 수 없어요.'])
    expect(describePointUseRules(rules({ minUsePoints: 1000, useUnit: 100, maxUseRatio: 50 }))).toEqual([
      '1,000P 이상부터 사용할 수 있어요.',
      '100P 단위로 사용할 수 있어요.',
      '결제 금액의 최대 50%까지 사용할 수 있어요.',
    ])
  })
})
