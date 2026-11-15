import { describe, it, expect } from 'vitest'
import { resolveBadges, type BadgeRuleForResolve } from '$lib/utils/resolveBadges'

const NOW = new Date('2026-11-14T00:00:00Z')

function rule(p: Partial<BadgeRuleForResolve> & { id: string }): BadgeRuleForResolve {
  return {
    priority: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
    product_ids: [],
    categories: [],
    ...p,
  }
}

describe('resolveBadges', () => {
  it('상품 직접 대상과 카테고리 대상의 합집합으로 노출한다', () => {
    const rules = [
      rule({ id: 'a', product_ids: ['p1'] }),
      rule({ id: 'b', categories: ['camera'] }),
    ]
    expect(resolveBadges(rules, { productId: 'p1', category: 'lens' }, NOW).map((r) => r.id)).toEqual(['a'])
    expect(resolveBadges(rules, { productId: 'p2', category: 'camera' }, NOW).map((r) => r.id)).toEqual(['b'])
    expect(resolveBadges(rules, { productId: 'p1', category: 'camera' }, NOW).map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('만료·미래 시작·비활성 배지는 제외한다', () => {
    const rules = [
      rule({ id: 'expired', product_ids: ['p1'], valid_until: '2026-11-13T00:00:00Z' }),
      rule({ id: 'future', product_ids: ['p1'], valid_from: '2026-11-15T00:00:00Z' }),
      rule({ id: 'off', product_ids: ['p1'], is_active: false }),
      rule({ id: 'ok', product_ids: ['p1'], valid_from: '2026-11-01T00:00:00Z', valid_until: '2026-12-01T00:00:00Z' }),
    ]
    expect(resolveBadges(rules, { productId: 'p1', category: null }, NOW).map((r) => r.id)).toEqual(['ok'])
  })

  it('우선순위 오름차순, 같으면 시작일이 빠른 순, 그래도 같으면 id 순', () => {
    const rules = [
      rule({ id: 'c', product_ids: ['p1'], priority: 2 }),
      rule({ id: 'b', product_ids: ['p1'], priority: 1, valid_from: '2026-11-10T00:00:00Z' }),
      rule({ id: 'a', product_ids: ['p1'], priority: 1, valid_from: '2026-11-01T00:00:00Z' }),
    ]
    expect(resolveBadges(rules, { productId: 'p1', category: null }, NOW).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('limit 으로 표시 개수를 제한한다', () => {
    const rules = [1, 2, 3, 4].map((n) => rule({ id: `r${n}`, product_ids: ['p1'], priority: n }))
    expect(resolveBadges(rules, { productId: 'p1', category: null }, NOW, 2).map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('대상이 없는 배지는 어떤 상품에도 노출되지 않는다', () => {
    expect(resolveBadges([rule({ id: 'x' })], { productId: 'p1', category: 'camera' }, NOW)).toEqual([])
  })
})
