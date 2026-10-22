import { describe, it, expect } from 'vitest'
import { isReturnDue } from '$lib/utils/returnDue'

// 2026-10-22 14:30 KST = 05:30 UTC
const NOW = new Date('2026-10-22T05:30:00Z')

describe('isReturnDue — 반납 일시 도래 판정(DB rental_return_due 와 같은 규칙)', () => {
  it('반납일이 지났으면 도래, 미래면 아직', () => {
    expect(isReturnDue('2026-10-21', '10:00', NOW)).toBe(true)
    expect(isReturnDue('2026-10-23', '10:00', NOW)).toBe(false)
  })
  it('당일은 반납시각 이후부터 도래(시각 없음·형식 오류=18:00, 24:00=그날 끝)', () => {
    expect(isReturnDue('2026-10-22', '14:00', NOW)).toBe(true)
    expect(isReturnDue('2026-10-22', '15:00', NOW)).toBe(false)
    expect(isReturnDue('2026-10-22', null, NOW)).toBe(false)
    expect(isReturnDue('2026-10-22', 'abc', NOW)).toBe(false)
    expect(isReturnDue('2026-10-22', '24:00', NOW)).toBe(false)
    expect(isReturnDue('2026-10-22', '10:30:00', NOW)).toBe(true)
  })
  it('날짜가 없거나 형식 오류면 도래 아님', () => {
    expect(isReturnDue(null, '10:00', NOW)).toBe(false)
    expect(isReturnDue('2026-10-22T00:00:00', '10:00', NOW)).toBe(true)
  })
})
