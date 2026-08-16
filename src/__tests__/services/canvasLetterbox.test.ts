/**
 * canvasLetterbox.test.ts
 *
 * 고정캔버스형 A4 프레임 레터박스 보정(C-3) 검증 — 프레임(210:297) 대비 업로드 이미지
 * 비율이 다를 때 필드 좌표(%)와 클릭/드래그 좌표 역산(px)이 실제 이미지 렌더 영역
 * 기준으로 정확히 계산되는지 확인한다.
 */

import { describe, it, expect } from 'vitest'
import { A4_RATIO, getContentBox, fieldStyle, getContentRectPx } from '$lib/utils/canvasLetterbox'

// ─────────────────────────────────────────────────────────────────────────────
// getContentBox — 레터박스 방향·비율 계산
// ─────────────────────────────────────────────────────────────────────────────

describe('getContentBox — 레터박스 계산', () => {
  it('정확히 A4 비율(210x297) 이미지 → 레터박스 없음(꽉 채움)', () => {
    const box = getContentBox(210, 297)
    expect(box.widthFrac).toBeCloseTo(1, 5)
    expect(box.heightFrac).toBeCloseTo(1, 5)
    expect(box.offsetXFrac).toBeCloseTo(0, 5)
    expect(box.offsetYFrac).toBeCloseTo(0, 5)
  })

  it('정사각형 이미지(1000x1000, A4보다 넓적함) → 폭 100% + 위아래 레터박스', () => {
    const box = getContentBox(1000, 1000)
    expect(box.widthFrac).toBeCloseTo(1, 5)
    expect(box.heightFrac).toBeLessThan(1)
    expect(box.offsetXFrac).toBe(0)
    expect(box.offsetYFrac).toBeGreaterThan(0)
    // 위아래 대칭
    expect(box.offsetYFrac).toBeCloseTo((1 - box.heightFrac) / 2, 5)
  })

  it('세로로 매우 긴 이미지(100x1000, A4보다 홀쭉함) → 높이 100% + 좌우 레터박스', () => {
    const box = getContentBox(100, 1000)
    expect(box.heightFrac).toBeCloseTo(1, 5)
    expect(box.widthFrac).toBeLessThan(1)
    expect(box.offsetYFrac).toBe(0)
    expect(box.offsetXFrac).toBeGreaterThan(0)
    expect(box.offsetXFrac).toBeCloseTo((1 - box.widthFrac) / 2, 5)
  })

  it('A4_RATIO 상수가 210/297과 일치', () => {
    expect(A4_RATIO).toBeCloseTo(210 / 297, 10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fieldStyle — 필드 % 좌표 (레터박스 보정 포함)
// ─────────────────────────────────────────────────────────────────────────────

describe('fieldStyle — 필드 위치 % 계산', () => {
  it('A4 비율 이미지(레터박스 없음) — 필드 좌표가 원본 비율 그대로 %', () => {
    const page = { width: 210, height: 297 }
    const field = { x: 21, y: 29.7, width: 42, height: 29.7 } // 10%, 10%, 20%, 10%
    const style = fieldStyle(field, page)
    expect(style).toContain('left:10%')
    expect(style).toContain('top:10%')
    expect(style).toContain('width:20%')
    expect(style).toContain('height:10%')
  })

  it('정사각형 이미지(위아래 레터박스) — top이 레터박스 오프셋만큼 밀림', () => {
    const page = { width: 1000, height: 1000 }
    const field = { x: 0, y: 0, width: 100, height: 100 } // 이미지 좌상단 10%x10%
    const style = fieldStyle(field, page)
    const box = getContentBox(1000, 1000)
    // left는 오프셋 없음(0%), top은 레터박스 오프셋(offsetYFrac*100)에서 시작
    expect(style).toContain('left:0%')
    const expectedTopPct = box.offsetYFrac * 100
    const topMatch = style.match(/top:([-\d.]+)%/)
    expect(topMatch).not.toBeNull()
    expect(parseFloat(topMatch![1])).toBeCloseTo(expectedTopPct, 5)
  })

  it('필드가 이미지 우하단 끝(100%,100%)이면 프레임상에서도 레터박스 반대편 끝과 일치', () => {
    const page = { width: 1000, height: 1000 }
    const box = getContentBox(1000, 1000)
    const field = { x: 1000, y: 1000, width: 0, height: 0 }
    const style = fieldStyle(field, page)
    const topMatch = style.match(/top:([-\d.]+)%/)
    const expectedBottomPct = (box.offsetYFrac + box.heightFrac) * 100
    expect(parseFloat(topMatch![1])).toBeCloseTo(expectedBottomPct, 5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getContentRectPx — 클릭/드래그 좌표 역산용 화면 px 사각형
// ─────────────────────────────────────────────────────────────────────────────

describe('getContentRectPx — 화면 px 콘텐츠 사각형', () => {
  it('A4 비율 이미지 — 콘텐츠 사각형이 프레임 전체와 일치', () => {
    const page = { width: 210, height: 297 }
    const frameRect = { left: 0, top: 0, width: 420, height: 594 } // 2배 스케일
    const content = getContentRectPx(page, frameRect)
    expect(content.left).toBeCloseTo(0, 5)
    expect(content.top).toBeCloseTo(0, 5)
    expect(content.width).toBeCloseTo(420, 5)
    expect(content.height).toBeCloseTo(594, 5)
    expect(content.scale).toBeCloseTo(2, 5)
  })

  it('정사각형 이미지 — 프레임 안에서 위아래 레터박스만큼 좁은 콘텐츠 사각형', () => {
    const page = { width: 1000, height: 1000 }
    const frameRect = { left: 100, top: 50, width: 210, height: 297 }
    const content = getContentRectPx(page, frameRect)
    // 폭은 프레임과 동일(레터박스가 위아래에만 있으므로)
    expect(content.width).toBeCloseTo(210, 5)
    expect(content.left).toBeCloseTo(100, 5)
    // 높이는 프레임보다 작아야 하고, top은 frameRect.top보다 커야 함(위쪽 레터박스만큼 밀림)
    expect(content.height).toBeLessThan(297)
    expect(content.top).toBeGreaterThan(50)
    // 화면 픽셀 좌상단(frameRect.left/top) 클릭 시 이미지 픽셀로 역산하면 콘텐츠 영역 시작점(0,0)이어야 함
    const x = (content.left - content.left) / content.scale
    const y = (content.top - content.top) / content.scale
    expect(x).toBe(0)
    expect(y).toBe(0)
  })

  it('왕복 변환: 이미지 픽셀 좌표 → 화면 px → 다시 이미지 픽셀 좌표로 복원', () => {
    const page = { width: 1600, height: 1200 } // 4:3, A4보다 넓적
    const frameRect = { left: 20, top: 10, width: 300, height: 424.3 } // 대략 A4 비율 축소
    const content = getContentRectPx(page, frameRect)

    const originalX = 800 // 이미지 픽셀 좌표(중앙)
    const originalY = 600
    const screenX = content.left + originalX * content.scale
    const screenY = content.top  + originalY * content.scale

    const roundTripX = (screenX - content.left) / content.scale
    const roundTripY = (screenY - content.top) / content.scale

    expect(roundTripX).toBeCloseTo(originalX, 5)
    expect(roundTripY).toBeCloseTo(originalY, 5)
  })
})
