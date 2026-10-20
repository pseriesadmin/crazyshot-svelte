// chatChime.test.ts — 딩동 소리 재생 간격 판단(여러 탭 동시 울림·연속 도착 겹침 방지)
import { describe, it, expect } from 'vitest'
import { shouldPlayChime, CHIME_MIN_GAP_MS } from '$lib/utils/chatChime'

describe('shouldPlayChime', () => {
  it('처음이면 재생한다', () => {
    expect(shouldPlayChime(1000, null)).toBe(true)
  })
  it('최소 간격 안에서는 재생하지 않는다', () => {
    expect(shouldPlayChime(10_000 + CHIME_MIN_GAP_MS - 1, 10_000)).toBe(false)
  })
  it('최소 간격이 지나면 재생한다', () => {
    expect(shouldPlayChime(10_000 + CHIME_MIN_GAP_MS, 10_000)).toBe(true)
  })
  it('저장된 시각이 미래(시계 변경)이거나 숫자가 아니면 재생한다', () => {
    expect(shouldPlayChime(1000, 5000)).toBe(true)
    expect(shouldPlayChime(1000, Number.NaN)).toBe(true)
  })
})
