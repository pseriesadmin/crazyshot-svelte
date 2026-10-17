import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  IMAGE_RESIZE_CORNERS, allowedHandleSide, pointerExtent, visibleBandOf, barPlacementOf, handleSpanOf, handleSpanXOf, createHandlePref,
} from '../../../lib/modules/doc-editor/core/imageTools'

describe('imageTools — 두 편집기 공통 이미지 도구 계산', () => {
  it('손잡이 모서리 4개, 정렬별 허용 쪽', () => {
    expect(IMAGE_RESIZE_CORNERS.map((c) => c.id)).toEqual(['nw', 'ne', 'sw', 'se'])
    expect(allowedHandleSide('l', 'center')).toBe(true)
    expect(allowedHandleSide('r', 'center')).toBe(true)
    expect(allowedHandleSide('l', 'left')).toBe(false)
    expect(allowedHandleSide('r', 'left')).toBe(true)
    expect(allowedHandleSide('l', 'right')).toBe(true)
    expect(allowedHandleSide('r', 'right')).toBe(false)
    expect(allowedHandleSide('l', 'center', true)).toBe(false) // 겹치기는 오른쪽만
    expect(allowedHandleSide('r', 'center', true)).toBe(true)
  })

  it('끌기 거리: 가운데=중심 대칭, 왼쪽=왼쪽 고정, 오른쪽=오른쪽 고정, 겹치기=왼쪽 고정', () => {
    const rect = { left: 100, right: 300, width: 200 }
    expect(pointerExtent('center', false, 350, rect)).toBe(300)
    expect(pointerExtent('center', false, 150, rect)).toBe(100)
    expect(pointerExtent('left', false, 350, rect)).toBe(250)
    expect(pointerExtent('right', false, 50, rect)).toBe(250)
    expect(pointerExtent('center', true, 350, rect)).toBe(250)
  })

  it('보이는 영역 계산: 위 → 아래 → 안쪽 순, 화면 밖이면 손잡이 없음', () => {
    const band = visibleBandOf(60, 900) // 68 ~ 892
    expect(band).toEqual({ visTop: 68, visBottom: 892 })
    expect(barPlacementOf({ top: 300, bottom: 400 }, band)).toEqual({ topV: 248, inside: false })
    expect(barPlacementOf({ top: 70, bottom: 400 }, band)).toEqual({ topV: 412, inside: false })
    expect(barPlacementOf({ top: -100, bottom: 1000 }, band).inside).toBe(true)
    expect(handleSpanOf({ top: 1000, bottom: 1200 }, band)).toBeNull()
    expect(handleSpanOf({ top: -500, bottom: 40 }, band)).toBeNull()
    const span = handleSpanOf({ top: -100, bottom: 1008 }, band)!
    expect(span.yTop).toBeGreaterThan(68)
    expect(span.yBottom).toBeLessThanOrEqual(892 - 14)
    expect(span.yBottom - span.yTop).toBeGreaterThanOrEqual(24)
  })

  it('가로 위치: 화면 가장자리·밖에 걸린 모서리 점을 화면 안으로 당긴다', () => {
    expect(handleSpanXOf({ left: 100, right: 500 }, 1000)).toEqual({ xL: 100, xR: 500 })
    expect(handleSpanXOf({ left: -63, right: 1071 }, 1071)).toEqual({ xL: 14, xR: 1057 })
    const tiny = handleSpanXOf({ left: -500, right: -400 }, 1000)
    expect(tiny.xR - tiny.xL).toBeGreaterThanOrEqual(24)
  })

  describe('표시 선호 저장', () => {
    beforeEach(() => {
      const mem = new Map<string, string>()
      vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } })
    })
    afterEach(() => { vi.unstubAllGlobals() })
    it('저장소를 못 써도 예외 없이 기본값(표시)', () => {
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
      const pref = createHandlePref('x')
      expect(pref.read()).toBe(true)
      expect(() => pref.write(false)).not.toThrow()
    })
    it('기본 표시, 끄면 기억, 다시 켜면 복귀', () => {
      const pref = createHandlePref('t-key')
      expect(pref.read()).toBe(true)
      pref.write(false)
      expect(createHandlePref('t-key').read()).toBe(false)
      pref.write(true)
      expect(createHandlePref('t-key').read()).toBe(true)
    })
  })
})
