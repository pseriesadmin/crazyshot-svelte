// panelSplit.test.ts — 대화 ↔ 고객 정보 영역 가로폭 조절: 합 100% 중 각 30%~70% 제한
import { describe, it, expect } from 'vitest'
import { clampComposePct, composePctFromPointer, composePctFromKey, parseStoredComposePct, COMPOSE_PCT_MIN, COMPOSE_PCT_MAX, COMPOSE_MIN_PX, clampInfoPct, infoPctFromPointer, infoPctFromKey, parseStoredInfoPct, INFO_PCT_MIN, INFO_PCT_MAX, INFO_PCT_DEFAULT } from '$lib/utils/panelSplit'

describe('panelSplit', () => {
  it('고객 정보 영역은 30~70%로 제한되고 대화 영역은 그 나머지(70~30%)가 된다', () => {
    expect(clampInfoPct(10)).toBe(INFO_PCT_MIN)
    expect(clampInfoPct(95)).toBe(INFO_PCT_MAX)
    expect(clampInfoPct(50)).toBe(50)
    expect(100 - clampInfoPct(10)).toBe(70)
    expect(100 - clampInfoPct(95)).toBe(30)
  })
  it('숫자가 아니면 기본값', () => {
    expect(clampInfoPct(Number.NaN)).toBe(INFO_PCT_DEFAULT)
  })
  it('포인터 위치로 비율 계산(컨테이너 오른쪽 끝 기준)', () => {
    const rect = { right: 1000, width: 800 }
    expect(infoPctFromPointer(600, rect)).toBe(50) // (1000-600)/800
    expect(infoPctFromPointer(990, rect)).toBe(INFO_PCT_MIN) // 너무 오른쪽 → 최소
    expect(infoPctFromPointer(0, rect)).toBe(INFO_PCT_MAX)   // 너무 왼쪽 → 최대
    expect(infoPctFromPointer(500, { right: 1000, width: 0 })).toBe(INFO_PCT_DEFAULT)
  })
  it('방향키: ←넓힘 →좁힘 Home 최대 End 최소, 한계를 넘지 않음', () => {
    expect(infoPctFromKey(36, 'ArrowLeft')).toBe(38)
    expect(infoPctFromKey(36, 'ArrowRight')).toBe(34)
    expect(infoPctFromKey(70, 'ArrowLeft')).toBe(70)
    expect(infoPctFromKey(30, 'ArrowRight')).toBe(30)
    expect(infoPctFromKey(36, 'Home')).toBe(70)
    expect(infoPctFromKey(36, 'End')).toBe(30)
    expect(infoPctFromKey(36, 'a')).toBeNull()
  })
  it('저장값 복원: 범위 밖 값은 제한, 잘못된 값은 null', () => {
    expect(parseStoredInfoPct('45')).toBe(45)
    expect(parseStoredInfoPct('5')).toBe(30)
    expect(parseStoredInfoPct('abc')).toBeNull()
    expect(parseStoredInfoPct(null)).toBeNull()
  })
})

describe('panelSplit — 위아래(하단 작성 그룹)', () => {
  it('하단 작성 그룹은 30~70%로 제한되고 대화 영역은 그 나머지(70~30%)가 된다', () => {
    expect(clampComposePct(5)).toBe(COMPOSE_PCT_MIN)
    expect(clampComposePct(99)).toBe(COMPOSE_PCT_MAX)
    expect(clampComposePct(50)).toBe(50)
    expect(100 - clampComposePct(5)).toBe(70)
    expect(100 - clampComposePct(99)).toBe(30)
  })
  it('포인터 위치로 비율 계산(컨테이너 아래 끝 기준)', () => {
    const rect = { bottom: 1000, height: 800 }
    expect(composePctFromPointer(600, rect)).toBe(50)           // (1000-600)/800
    expect(composePctFromPointer(990, rect)).toBe(COMPOSE_PCT_MIN) // 너무 아래 → 최소
    expect(composePctFromPointer(0, rect)).toBe(COMPOSE_PCT_MAX)   // 너무 위 → 최대
    expect(composePctFromPointer(500, { bottom: 1000, height: 0 })).toBeNull()
  })
  it('방향키: ↑키움 ↓줄임 Home 최대 End 최소, 자동(null)이면 측정값에서 시작, 한계 유지', () => {
    expect(composePctFromKey(40, 0, 'ArrowUp')).toBe(42)
    expect(composePctFromKey(40, 0, 'ArrowDown')).toBe(38)
    expect(composePctFromKey(null, 35, 'ArrowUp')).toBe(37)
    expect(composePctFromKey(70, 0, 'ArrowUp')).toBe(70)
    expect(composePctFromKey(30, 0, 'ArrowDown')).toBe(30)
    expect(composePctFromKey(40, 0, 'Home')).toBe(70)
    expect(composePctFromKey(40, 0, 'End')).toBe(30)
    expect(composePctFromKey(40, 0, 'x')).toBeNull()
  })
  it('저장값 복원: 범위 밖은 제한, 없거나 잘못된 값은 null(=자동)', () => {
    expect(parseStoredComposePct('45')).toBe(45)
    expect(parseStoredComposePct('5')).toBe(30)
    expect(parseStoredComposePct('abc')).toBeNull()
    expect(parseStoredComposePct(null)).toBeNull()
  })
  it('내용 최소 높이 하한이 정의돼 있다', () => {
    expect(COMPOSE_MIN_PX).toBeGreaterThanOrEqual(200)
  })
})
