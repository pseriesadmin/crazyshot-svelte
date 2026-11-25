import { describe, it, expect } from 'vitest'
import { normalizeMdPopupCondition, isMdPopupAllowed, resolveMdPopupOpen } from '$lib/utils/mdPopupCondition'

describe('MD 추천 팝업 노출조건', () => {
  it('값이 없으면 찜 ON·예약 OFF(기존 동작 유지)', () => {
    for (const raw of [undefined, null, 'x', 1, []]) {
      expect(normalizeMdPopupCondition(raw)).toEqual({ on_wish: true, on_reserve: false })
    }
  })

  it('저장된 값은 그대로 반영하고, 빠진 필드만 기본값', () => {
    expect(normalizeMdPopupCondition({ on_wish: false, on_reserve: true })).toEqual({ on_wish: false, on_reserve: true })
    expect(normalizeMdPopupCondition({ on_reserve: true })).toEqual({ on_wish: true, on_reserve: true })
    expect(normalizeMdPopupCondition({ on_wish: 'yes', on_reserve: 1 })).toEqual({ on_wish: true, on_reserve: false })
  })

  it('조건 조회가 실패(null)하면 찜은 기존처럼 열고 예약신청은 열지 않는다', () => {
    expect(resolveMdPopupOpen(null, 'wish')).toBe(true)
    expect(resolveMdPopupOpen(null, 'reserve')).toBe(false)
  })

  it('조건이 있으면 최종 판정은 행위별 허용 값을 그대로 따른다', () => {
    expect(resolveMdPopupOpen({ on_wish: false, on_reserve: false }, 'wish')).toBe(false)
    expect(resolveMdPopupOpen({ on_wish: true, on_reserve: true }, 'reserve')).toBe(true)
    expect(resolveMdPopupOpen({ on_wish: false, on_reserve: true }, 'wish')).toBe(false)
  })

  it('행위별로 따로 판정한다(찜 ↔ 예약신청)', () => {
    const c = { on_wish: true, on_reserve: false }
    expect(isMdPopupAllowed(c, 'wish')).toBe(true)
    expect(isMdPopupAllowed(c, 'reserve')).toBe(false)
    const d = { on_wish: false, on_reserve: true }
    expect(isMdPopupAllowed(d, 'wish')).toBe(false)
    expect(isMdPopupAllowed(d, 'reserve')).toBe(true)
  })
})
