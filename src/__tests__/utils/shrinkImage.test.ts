import { describe, it, expect } from 'vitest'
import { shrinkTargetSize, SHRINK_STEPS, SERVER_UPLOAD_MAX_BYTES } from '../../lib/utils/imageResize'

describe('업로드 전 자동 줄임 — 계산', () => {
  it('상한은 서버와 같은 4MB, 단계는 점점 강해진다', () => {
    expect(SERVER_UPLOAD_MAX_BYTES).toBe(4 * 1024 * 1024)
    for (let i = 1; i < SHRINK_STEPS.length; i++) {
      expect(SHRINK_STEPS[i].scale).toBeLessThanOrEqual(SHRINK_STEPS[i - 1].scale)
      expect(SHRINK_STEPS[i].quality).toBeLessThanOrEqual(SHRINK_STEPS[i - 1].quality)
    }
  })
  it('긴 변을 maxSide×배율 이하로 줄이고 비율을 유지, 업스케일은 하지 않는다', () => {
    expect(shrinkTargetSize(4000, 3000, 2000, 1)).toEqual({ w: 2000, h: 1500 })
    expect(shrinkTargetSize(3000, 4000, 2000, 0.5)).toEqual({ w: 750, h: 1000 })
    expect(shrinkTargetSize(800, 600, 2000, 1)).toEqual({ w: 800, h: 600 })
    expect(shrinkTargetSize(1, 5000, 2000, 0.3).h).toBe(600)
    expect(shrinkTargetSize(1, 5000, 2000, 0.3).w).toBeGreaterThanOrEqual(1)
  })
})
