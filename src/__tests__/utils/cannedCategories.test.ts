/**
 * TDD: 빠른답변 분류 설정 — 기본 6개 + 관리자가 추가하는 분류 (2026-10-08)
 * 기본(시스템) 분류는 삭제·키 변경 불가, 이름·순서·노출만 바꿀 수 있다. 추가 분류는 키가 자동으로 붙는다.
 * "민감 분류"(human_only)는 자동답변 시 상담원 알림 대상 — 기본은 파손·CS.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CANNED_CATEGORIES, getCategoryLabel, makeCategoryKey, validateCategoryLabel, sortCategories, sensitiveKeys, aiAllowedKeys, type CannedCategory,
} from '$lib/constants/cannedResponseCategories'

const custom = (value: string, label: string, sort_order: number, extra: Partial<CannedCategory> = {}): CannedCategory => ({
  value, label, sort_order, is_system: false, is_active: true, human_only: false, ai_allowed: false, ...extra,
})

describe('기본 분류', () => {
  it('기본 6개이고 파손·CS만 민감 분류다', () => {
    expect(DEFAULT_CANNED_CATEGORIES.map((c) => c.value)).toEqual(['return', 'payment', 'reservation', 'damage', 'general', 'cs'])
    expect(DEFAULT_CANNED_CATEGORIES.every((c) => c.is_system && c.is_active)).toBe(true)
    expect(sensitiveKeys(DEFAULT_CANNED_CATEGORIES)).toEqual(['damage', 'cs'])
  })
})

describe('getCategoryLabel', () => {
  it('목록을 주면 추가 분류의 이름도 보여 준다', () => {
    const list = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7)]
    expect(getCategoryLabel('c1', list)).toBe('배송')
    expect(getCategoryLabel('return', list)).toBe('반납')
  })
  it('목록이 없으면 기본 6개 기준(하위 호환), 모르는 값·빈 값은 기타', () => {
    expect(getCategoryLabel('payment')).toBe('결제')
    expect(getCategoryLabel('nope')).toBe('기타')
    expect(getCategoryLabel(null)).toBe('기타')
  })
  it('이름을 바꾼 기본 분류도 바뀐 이름으로 보여 준다', () => {
    const list = DEFAULT_CANNED_CATEGORIES.map((c) => (c.value === 'general' ? { ...c, label: '기타문의' } : c))
    expect(getCategoryLabel('general', list)).toBe('기타문의')
  })
})

describe('makeCategoryKey', () => {
  it('c1, c2… 순서로 붙이고 이미 있는 키·번호는 건너뛴다', () => {
    expect(makeCategoryKey(DEFAULT_CANNED_CATEGORIES)).toBe('c1')
    expect(makeCategoryKey([...DEFAULT_CANNED_CATEGORIES, custom('c1', 'A', 7), custom('c3', 'B', 8)])).toBe('c4')
  })
})

describe('validateCategoryLabel', () => {
  const list = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7)]
  it('1~10자의 공백 정리된 이름만 허용', () => {
    expect(validateCategoryLabel('  상품 문의 ', list)).toEqual({ ok: true, label: '상품 문의' })
    expect(validateCategoryLabel('', list).ok).toBe(false)
    expect(validateCategoryLabel('가'.repeat(11), list).ok).toBe(false)
  })
  it('다른 분류와 이름이 같으면(대소문자·공백 무시) 거부, 자기 자신은 허용', () => {
    expect(validateCategoryLabel('배송', list).ok).toBe(false)
    expect(validateCategoryLabel(' 반 납 ', list).ok).toBe(false)
    expect(validateCategoryLabel('배송', list, 'c1')).toEqual({ ok: true, label: '배송' })
  })
})

describe('sortCategories', () => {
  it('sort_order 순으로 정렬하고 비활성은 옵션에 따라 뺀다', () => {
    const list = [custom('c2', 'B', 9), custom('c1', 'A', 7, { is_active: false }), ...DEFAULT_CANNED_CATEGORIES]
    expect(sortCategories(list).map((c) => c.value)).toEqual(['return', 'payment', 'reservation', 'damage', 'general', 'cs', 'c1', 'c2'])
    expect(sortCategories(list, { activeOnly: true }).map((c) => c.value)).not.toContain('c1')
  })
})

describe('sensitiveKeys', () => {
  it('민감 표시한 추가 분류도 포함한다(비활성이어도 안전 쪽으로 유지)', () => {
    const list = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '분쟁', 7, { human_only: true, is_active: false })]
    expect(sensitiveKeys(list)).toEqual(['damage', 'cs', 'c1'])
  })
})

import { planCategoryChange } from '$lib/constants/cannedResponseCategories'

describe('planCategoryChange — 설정 변경 규칙', () => {
  const base = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7), custom('c2', '분쟁', 8, { human_only: true })]
  it('추가: 새 키·마지막 순서·민감 여부를 정한다', () => {
    const r = planCategoryChange(base, { type: 'add', label: ' 상품  문의 ', human_only: false })
    expect(r).toEqual({ ok: true, action: 'insert', row: { value: 'c3', label: '상품 문의', sort_order: 9, is_system: false, is_active: true, human_only: false, ai_allowed: false } })
  })
  it('추가: 이름 검증 실패는 거부', () => {
    expect(planCategoryChange(base, { type: 'add', label: '배송' })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'add', label: '' })).toMatchObject({ ok: false })
  })
  it('수정: 추가 분류는 이름·노출·민감·순서를 바꿀 수 있다', () => {
    expect(planCategoryChange(base, { type: 'update', value: 'c1', label: '배송문의', is_active: false, human_only: true, sort_order: 3 })).toEqual({
      ok: true, action: 'update', value: 'c1', patch: { label: '배송문의', is_active: false, human_only: true, sort_order: 3 },
    })
  })
  it('수정: 기본 분류는 이름·순서만(노출 끄기·민감 변경 불가)', () => {
    expect(planCategoryChange(base, { type: 'update', value: 'return', label: '반납·회수', sort_order: 2 })).toMatchObject({ ok: true, patch: { label: '반납·회수', sort_order: 2 } })
    expect(planCategoryChange(base, { type: 'update', value: 'return', is_active: false })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'update', value: 'damage', human_only: false })).toMatchObject({ ok: false })
  })
  it('수정: 없는 분류·빈 변경은 거부', () => {
    expect(planCategoryChange(base, { type: 'update', value: 'zzz', label: 'x' })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'update', value: 'c1' })).toMatchObject({ ok: false })
  })
  it('삭제: 추가 분류만, 쓰는 빠른답변이 없을 때만', () => {
    expect(planCategoryChange(base, { type: 'delete', value: 'c1' }, { usage: 0 })).toEqual({ ok: true, action: 'delete', value: 'c1' })
    expect(planCategoryChange(base, { type: 'delete', value: 'c1' }, { usage: 3 })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'delete', value: 'return' }, { usage: 0 })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'delete', value: 'nope' }, { usage: 0 })).toMatchObject({ ok: false })
  })
})

describe('planCategoryChange — 드래그 순서 변경', () => {
  const base = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7), custom('c2', '분쟁', 8)]
  const allValues = base.map((c) => c.value)
  it('모든 분류를 한 번씩 담은 새 순서면 1부터 차례로 순서 값을 정한다', () => {
    const order = ['c1', ...allValues.filter((v) => v !== 'c1')]
    expect(planCategoryChange(base, { type: 'reorder', order })).toEqual({
      ok: true, action: 'reorder', sorted: order.map((value, i) => ({ value, sort_order: i + 1 })),
    })
  })
  it('빠진 분류·모르는 분류·중복이 있으면 거부(일부만 바꿔 순서가 꼬이는 것 방지)', () => {
    expect(planCategoryChange(base, { type: 'reorder', order: allValues.slice(1) })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'reorder', order: [...allValues, 'zzz'] })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'reorder', order: [...allValues.slice(1), allValues[1]] })).toMatchObject({ ok: false })
  })
  it('순서가 그대로여도 정상 처리(값만 1..n으로 정돈)', () => {
    expect(planCategoryChange(base, { type: 'reorder', order: allValues })).toMatchObject({ ok: true, action: 'reorder' })
  })
})


describe('AI 허용 분류(ai_allowed) — 분류 설정으로 통합 (2026-10-08)', () => {
  it('기본값은 모두 허용 안 함(안전 쪽). 민감 분류는 허용할 수 없다', () => {
    expect(DEFAULT_CANNED_CATEGORIES.every((c) => c.ai_allowed === false)).toBe(true)
  })
  it('aiAllowedKeys: 활성이고 허용 표시된 비민감 분류만, 순서대로', () => {
    const list = [
      ...DEFAULT_CANNED_CATEGORIES.map((c) => (c.value === 'return' || c.value === 'payment' ? { ...c, ai_allowed: true } : c)),
      custom('c1', '배송', 7, { ai_allowed: true }),
      custom('c2', '숨김', 8, { ai_allowed: true, is_active: false }),
      custom('c3', '분쟁', 9, { ai_allowed: true, human_only: true }),
    ]
    expect(aiAllowedKeys(list)).toEqual(['return', 'payment', 'c1'])
  })
  const base = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7), custom('c2', '분쟁', 8, { human_only: true })]
  it('수정: 기본 분류(민감 아님)와 추가 분류의 AI 허용을 바꿀 수 있다', () => {
    expect(planCategoryChange(base, { type: 'update', value: 'return', ai_allowed: true })).toEqual({ ok: true, action: 'update', value: 'return', patch: { ai_allowed: true } })
    expect(planCategoryChange(base, { type: 'update', value: 'c1', ai_allowed: true })).toMatchObject({ ok: true, patch: { ai_allowed: true } })
  })
  it('수정: 민감 분류(파손·CS·민감 표시한 분류)는 AI 허용 불가', () => {
    expect(planCategoryChange(base, { type: 'update', value: 'damage', ai_allowed: true })).toMatchObject({ ok: false })
    expect(planCategoryChange(base, { type: 'update', value: 'c2', ai_allowed: true })).toMatchObject({ ok: false })
  })
  it('수정: 허용 중인 분류를 민감으로 바꾸면 AI 허용이 함께 꺼진다(같은 변경에서 둘 다 요청해도 거부)', () => {
    const allowed = [...DEFAULT_CANNED_CATEGORIES, custom('c1', '배송', 7, { ai_allowed: true })]
    expect(planCategoryChange(allowed, { type: 'update', value: 'c1', human_only: true })).toEqual({ ok: true, action: 'update', value: 'c1', patch: { human_only: true, ai_allowed: false } })
    expect(planCategoryChange(allowed, { type: 'update', value: 'c1', human_only: true, ai_allowed: true })).toMatchObject({ ok: false })
  })
  it('추가: 새 분류는 AI 허용 꺼짐으로 시작', () => {
    expect(planCategoryChange(base, { type: 'add', label: '상품 문의' })).toMatchObject({ ok: true, row: { ai_allowed: false } })
  })
})
