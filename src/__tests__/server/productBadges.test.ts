import { describe, it, expect } from 'vitest'
import { groupBadgesByProduct, loadBadgeCouponIds, loadProductBadgeMap, markBadgeLinkedCoupons } from '$lib/server/productBadges'
import type { CustomerBadge } from '$lib/types/badge'

const badge = (product_id: string, badge_id: string): CustomerBadge => ({
  product_id, badge_id, priority: 0, kind: 'textbar', svg_url: null, text: 'NEW', bg_color: '#3B2F8A', text_color: '#FFFFFF',
})

describe('productBadges', () => {
  it('상품별로 묶되 순서를 유지한다', () => {
    const m = groupBadgesByProduct([badge('p1', 'a'), badge('p2', 'b'), badge('p1', 'c')])
    expect(m.p1.map((b) => b.badge_id)).toEqual(['a', 'c'])
    expect(m.p2.map((b) => b.badge_id)).toEqual(['b'])
  })

  it('RPC 는 id 묶음당 1회만 호출하고 중복·빈 값은 제거한다', async () => {
    let calls = 0
    let sent: unknown
    const client = { rpc: async (_fn: string, args: Record<string, unknown>) => { calls += 1; sent = args; return { data: [badge('p1', 'a')], error: null } } }
    const m = await loadProductBadgeMap(client, ['p1', 'p1', null, undefined, 'p2'])
    expect(calls).toBe(1)
    expect(sent).toEqual({ p_product_ids: ['p1', 'p2'] })
    expect(m.p1).toHaveLength(1)
  })

  it('상품이 없으면 호출하지 않고, 실패하면 빈 결과로 화면을 막지 않는다', async () => {
    let calls = 0
    const ok = { rpc: async () => { calls += 1; return { data: [], error: null } } }
    expect(await loadProductBadgeMap(ok, [])).toEqual({})
    expect(calls).toBe(0)
    const bad = { rpc: async () => ({ data: null, error: { message: 'x' } }) }
    expect(await loadProductBadgeMap(bad, ['p1'])).toEqual({})
    const boom = { rpc: async () => { throw new Error('network') } }
    expect(await loadProductBadgeMap(boom, ['p1'])).toEqual({})
    expect((await loadBadgeCouponIds(boom, ['p1'])).size).toBe(0)
  })

  it('연동 쿠폰을 앞으로 보내고 표식만 달며 나머지 순서·값은 유지한다', () => {
    const rows = [{ coupon_id: 'c1', n: 1 }, { coupon_id: 'c2', n: 2 }, { coupon_id: 'c3', n: 3 }, { coupon_id: 'c4', n: 4 }]
    const out = markBadgeLinkedCoupons(rows, new Set(['c3', 'c2']))
    expect(out.map((r) => r.coupon_id)).toEqual(['c2', 'c3', 'c1', 'c4'])
    expect(out.map((r) => r.badgeLinked)).toEqual([true, true, false, false])
    expect(out.map((r) => r.n)).toEqual([2, 3, 1, 4])
  })

  it('연동 쿠폰이 없으면 원래 순서 그대로다', () => {
    const rows = [{ coupon_id: 'c1' }, { coupon_id: 'c2' }]
    expect(markBadgeLinkedCoupons(rows, new Set()).map((r) => r.coupon_id)).toEqual(['c1', 'c2'])
  })
})
