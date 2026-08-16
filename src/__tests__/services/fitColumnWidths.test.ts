/**
 * fitColumnWidths.test.ts
 *
 * 임포트 표 컬럼너비를 A4 본문 폭에 맞춰 비율 유지 축소하는 유틸 검증
 * (2026-08-15 실사용 중 발견 — 컬럼이 많은 표가 A4 페이지 밖으로 비정상적으로 넓게
 * 펼쳐지는 문제 수정).
 */

import { describe, it, expect } from 'vitest'
import { fitColumnWidthsToTarget, A4_CONTENT_WIDTH_PX } from '$lib/utils/docImport/fitColumnWidths'

describe('fitColumnWidthsToTarget', () => {
  it('합이 목표 폭 이하면 원본 그대로 반환(변형 없음)', () => {
    const widths = [100, 200, 150]
    const result = fitColumnWidthsToTarget(widths, 500)
    expect(result).toEqual(widths)
  })

  it('합이 목표 폭을 넘으면 비율을 유지한 채 축소된다', () => {
    // 17열 × 100px = 1700px, 목표 642px → scale ≈ 0.3776
    const widths = Array.from({ length: 17 }, () => 100)
    const result = fitColumnWidthsToTarget(widths, A4_CONTENT_WIDTH_PX)
    const total = result.reduce((a: number, b) => a + (b ?? 0), 0)
    // 최소폭(20px) 바닥 처리로 정확히 일치하진 않을 수 있으나 목표 폭에 가까워야 함
    expect(total).toBeLessThanOrEqual(A4_CONTENT_WIDTH_PX + 17 * 1) // 반올림 오차 허용
    expect(total).toBeGreaterThan(A4_CONTENT_WIDTH_PX * 0.9)
    // 원본 비율(전부 동일)이 유지돼야 함 — 축소 후에도 모든 컬럼이 거의 동일
    const uniqueValues = new Set(result)
    expect(uniqueValues.size).toBe(1)
  })

  it('서로 다른 너비의 상대 비율이 축소 후에도 유지된다', () => {
    const widths = [100, 300] // 1:3 비율, 합 400
    const result = fitColumnWidthsToTarget(widths, 200) // 목표 200 → scale 0.5
    expect(result[0]).toBe(50)
    expect(result[1]).toBe(150)
    // 비율(1:3) 유지 확인
    expect((result[1] as number) / (result[0] as number)).toBeCloseTo(3, 5)
  })

  it('축소해도 컬럼당 최소 20px 이하로는 내려가지 않는다', () => {
    // 컬럼 100개 × 50px = 5000px, 목표 642px면 컬럼당 6.42px이 나와야 하지만 최소 20px 유지
    const widths = Array.from({ length: 100 }, () => 50)
    const result = fitColumnWidthsToTarget(widths, A4_CONTENT_WIDTH_PX)
    expect(result.every((w) => (w ?? 0) >= 20)).toBe(true)
  })

  it('null(정보 없음) 컬럼은 축소 계산에서 제외되고 null 그대로 유지된다', () => {
    const widths = [100, null, 100, null]
    // known 합 200 <= 목표 642 → 축소 불필요, 원본 그대로
    const result = fitColumnWidthsToTarget(widths, A4_CONTENT_WIDTH_PX)
    expect(result).toEqual(widths)
  })

  it('null이 섞여 있어도 known 값 합이 목표를 넘으면 known 값만 비율 축소됨', () => {
    const widths = [400, null, 400] // known 합 800 > 목표 642
    const result = fitColumnWidthsToTarget(widths, A4_CONTENT_WIDTH_PX)
    expect(result[1]).toBeNull()
    expect(result[0]).toBe(result[2])
    expect((result[0] as number) + (result[2] as number)).toBeLessThanOrEqual(A4_CONTENT_WIDTH_PX + 2)
  })

  it('모든 값이 null이거나 빈 배열이면 그대로 반환', () => {
    expect(fitColumnWidthsToTarget([])).toEqual([])
    expect(fitColumnWidthsToTarget([null, null])).toEqual([null, null])
  })

  it('targetWidthPx 미지정 시 기본값 A4_CONTENT_WIDTH_PX 사용', () => {
    const widths = [1000, 1000]
    const result = fitColumnWidthsToTarget(widths)
    const total = result.reduce((a: number, b) => a + (b ?? 0), 0)
    expect(total).toBeLessThanOrEqual(A4_CONTENT_WIDTH_PX + 2)
  })
})
