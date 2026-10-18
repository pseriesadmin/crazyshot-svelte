import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  IMAGE_RESIZE_CORNERS, allowedHandleSide, pointerExtent, visibleBandOf, barPlacementOf, handleSpanOf, handleSpanXOf, barLeftOf, intersectClipBoxes, createHandlePref,
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
    expect(barPlacementOf({ top: 300, bottom: 400 }, band)).toEqual({ topV: 237, inside: false }) // 위쪽 점(300±7) 위에 간격을 두고
    expect(barPlacementOf({ top: 70, bottom: 400 }, band)).toEqual({ topV: 415, inside: false }) // 위가 모자라면 아래쪽 점(400±7) 아래
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

  it('점은 이미지의 실제 모서리에 놓이고(도구줄 때문에 밀리지 않는다), 도구줄은 어떤 위치·크기에서도 점을 가리지 않는다', () => {
    const band = visibleBandOf(60, 900) // 68~892
    // 화면 안에 완전히 보이는 이미지: 점 = 실제 위·아래 모서리
    expect(handleSpanOf({ top: 300, bottom: 600 }, band)).toEqual({ yTop: 300, yBottom: 600 })
    const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1
    let checked = 0
    // 위치·높이를 훑으며 확인: 도구줄 [topV, topV+48] 이 위·아래 점 [y±7] 과 겹치지 않는다(이미지가 최소 100px일 때)
    for (let top = -800; top <= 1000; top += 37) {
      for (const h of [100, 160, 260, 500, 820, 1400]) {
        const r = { top, bottom: top + h }
        const span = handleSpanOf(r, band)
        if (!span) continue
        const bar = barPlacementOf(r, band)
        const y0 = bar.topV, y1 = bar.topV + 48
        expect(overlaps(y0, y1, span.yTop - 7, span.yTop + 7), `위쪽 점 가림 top=${top} h=${h}`).toBe(false)
        if (span.yBottom - span.yTop >= 62) expect(overlaps(y0, y1, span.yBottom - 7, span.yBottom + 7), `아래쪽 점 가림 top=${top} h=${h}`).toBe(false)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(80)
    // 작은 이미지는 바깥(위 또는 아래)에, 화면을 가득 채우는 큰 이미지만 안쪽(위쪽 점 아래)
    expect(barPlacementOf({ top: 400, bottom: 560 }, band).inside).toBe(false)
    expect(barPlacementOf({ top: 80, bottom: 240 }, band).inside).toBe(false) // 위가 모자라도 아래 바깥으로
    const big = barPlacementOf({ top: 100, bottom: 880 }, band)
    expect(big.inside).toBe(true)
    expect(big.topV).toBeGreaterThanOrEqual(handleSpanOf({ top: 100, bottom: 880 }, band)!.yTop + 7)
  })

  it('스크롤 상자 안으로 좁히기: 점·도구줄이 상자 밖(화면 아래 푸터 위 등)에 놓이지 않는다', () => {
    const clip = { top: 100, bottom: 600, left: 40, right: 1100 }
    // 창 기준 보이는 범위는 68~892지만, 스크롤 상자는 100~600 → 108~592
    expect(visibleBandOf(60, 900, clip)).toEqual({ visTop: 108, visBottom: 592 })
    expect(visibleBandOf(60, 900, null)).toEqual({ visTop: 68, visBottom: 892 })
    // 상자보다 큰 묶음: 아래 점이 상자 안(592-14)으로 당겨진다
    const span = handleSpanOf({ top: 171, bottom: 996 }, visibleBandOf(60, 900, clip))!
    expect(span.yBottom).toBeLessThanOrEqual(592 - 14)
    // 가로도 상자 안으로
    expect(handleSpanXOf({ left: 40, right: 1240 }, 1280, 14, clip)).toEqual({ xL: 54, xR: 1086 })
    // 상자 밖으로 완전히 밀려난 묶음은 점 없음
    expect(handleSpanOf({ top: 700, bottom: 1200 }, visibleBandOf(60, 900, clip))).toBeNull()
  })

  it('도구줄 가로 위치: 대상 왼쪽에 맞추되 보이는 영역 오른쪽을 넘으면 왼쪽으로 당긴다', () => {
    const bounds = { left: 0, right: 1000 }
    expect(barLeftOf(300, 560, bounds)).toBe(300) // 충분히 들어오면 대상 왼쪽 그대로
    expect(barLeftOf(707, 563, bounds)).toBe(429) // 오른쪽 정렬한 작은 이미지(왼쪽 707, 도구줄 563) → 1000-8-563
    expect(barLeftOf(707, 563, bounds) + 563).toBeLessThanOrEqual(1000 - 8)
    expect(barLeftOf(-50, 560, bounds)).toBe(8) // 왼쪽으로 벗어나면 왼쪽 여백
    // 보이는 영역보다 도구줄이 더 넓으면 왼쪽 끝을 우선 보이게
    expect(barLeftOf(500, 1200, bounds)).toBe(8)
    // 스크롤 상자(clip) 범위 안으로
    expect(barLeftOf(800, 400, { left: 200, right: 900 })).toBe(492)
    expect(barLeftOf(210, 400, { left: 200, right: 900 })).toBe(210)
  })

  it('조상 영역 교집합: 겹침 계산, 크기 0(레이아웃 없음)은 무시, 없으면 null', () => {
    expect(intersectClipBoxes([])).toBeNull()
    expect(intersectClipBoxes([{ top: 0, bottom: 0, left: 0, right: 0 }])).toBeNull()
    const r = intersectClipBoxes([
      { top: 0, bottom: 900, left: 0, right: 1280 },
      { top: 153, bottom: 927, left: 200, right: 1200 },
      { top: -50, bottom: 600, left: 0, right: 1280 },
    ])
    expect(r).toEqual({ top: 153, bottom: 600, left: 200, right: 1200 })
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
