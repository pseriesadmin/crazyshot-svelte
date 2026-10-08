/**
 * TDD: 빠른답변 분류 서버 로더 — DB 우선·기본 폴백·민감 분류 캐시 (2026-10-08)
 */
import { describe, it, expect } from 'vitest'
import { loadCannedCategories, mergeWithDefaults, isAssignableCategory, loadSensitiveCategoryKeys, resetSensitiveCategoryCache } from '$lib/server/cannedCategories'

const adminWith = (res: { data?: unknown; error?: unknown }) => ({ from: () => ({ select: async () => res }) })

describe('mergeWithDefaults', () => {
  it('DB 행에 추가 분류가 있으면 순서대로 포함한다', () => {
    const rows = [
      { value: 'return', label: '반납', sort_order: 1, is_system: true, is_active: true, human_only: false },
      { value: 'c1', label: '배송', sort_order: 7, is_system: false, is_active: true, human_only: false },
    ]
    const out = mergeWithDefaults(rows)
    expect(out.map((c) => c.value)).toEqual(['return', 'payment', 'reservation', 'damage', 'general', 'cs', 'c1'])
  })
  it('기본 분류의 이름 변경은 반영하되 민감 여부는 코드 기준으로 고정한다', () => {
    const out = mergeWithDefaults([{ value: 'damage', label: '장비파손', sort_order: 4, is_system: true, is_active: true, human_only: false }])
    const damage = out.find((c) => c.value === 'damage')!
    expect(damage.label).toBe('장비파손')
    expect(damage.human_only).toBe(true)
  })
  it('null·이상한 행은 무시하고 기본 6개를 돌려준다', () => {
    expect(mergeWithDefaults(null).map((c) => c.value)).toEqual(['return', 'payment', 'reservation', 'damage', 'general', 'cs'])
    expect(mergeWithDefaults([{ value: 3 as never }, null as never]).length).toBe(6)
  })
})

describe('loadCannedCategories', () => {
  it('조회 실패·예외여도 기본 6개로 폴백한다', async () => {
    expect((await loadCannedCategories(adminWith({ error: { message: 'x' } }))).length).toBe(6)
    expect((await loadCannedCategories({ from: () => { throw new Error('boom') } })).length).toBe(6)
  })
})

describe('isAssignableCategory', () => {
  const list = mergeWithDefaults([{ value: 'c1', label: '배송', sort_order: 7, is_system: false, is_active: false, human_only: false }])
  it('빈 값·존재하는 활성 분류만 허용, 비활성·모르는 값은 거부', () => {
    expect(isAssignableCategory(null, list)).toBe(true)
    expect(isAssignableCategory('', list)).toBe(true)
    expect(isAssignableCategory('return', list)).toBe(true)
    expect(isAssignableCategory('c1', list)).toBe(false)
    expect(isAssignableCategory('zzz', list)).toBe(false)
  })
})

describe('loadSensitiveCategoryKeys', () => {
  it('민감 분류 키를 읽고 60초 동안 캐시한다', async () => {
    resetSensitiveCategoryCache()
    let calls = 0
    const admin = { from: () => ({ select: async () => { calls++; return { data: [{ value: 'c2', label: '분쟁', sort_order: 8, is_system: false, is_active: true, human_only: true }], error: null } } }) }
    let t = 1000
    const k1 = await loadSensitiveCategoryKeys(admin, () => t)
    t += 30_000
    await loadSensitiveCategoryKeys(admin, () => t)
    expect([...k1].sort()).toEqual(['c2', 'cs', 'damage'])
    expect(calls).toBe(1)
    t += 31_000
    await loadSensitiveCategoryKeys(admin, () => t)
    expect(calls).toBe(2)
  })
})
