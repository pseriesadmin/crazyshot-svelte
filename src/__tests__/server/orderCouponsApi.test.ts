import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/cms/reservations/[id]/order-coupons — 결제정보 탭 쿠폰 아코디언 데이터 (2026-10-02)
 *
 * 완료기준(B-START):
 *   정상 동작   : 다중쿠폰 주문은 order_coupons 기준으로 쿠폰별 단계·합계를 돌려주고 저장된 할인액과 일치(consistent=true)한다.
 *   막아야 할 것 : 비CMS 호출은 401, 잘못된 id는 400. 주문 미연결 예약은 빈 목록(에러 아님).
 *   실패했을 때  : 관리자가 쿠폰별 금액을 확인할 수 없거나, 화면 계산이 저장값과 달라도 알려주지 못한다.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

interface Db {
  orderItem: { order_id: number } | null
  order: Record<string, unknown> | null
  orderCoupons: Array<{ coupon_id: string; coupons: Record<string, unknown> | null }>
  legacy: { coupon_id: string; coupons: Record<string, unknown> | null } | null
}
let db: Db

function makeFrom(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      if (table === 'order_items') return { data: db.orderItem, error: null }
      if (table === 'orders') return { data: db.order, error: null }
      if (table === 'user_coupons') return { data: db.legacy, error: null }
      return { data: null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) => {
      const data = table === 'order_coupons' ? db.orderCoupons : []
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return builder
}
let firstDayBaseRpc = 35000
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeFrom(t),
    rpc: async () => ({ data: firstDayBaseRpc, error: null }),
  }),
}))

const FIXED = '859f9e2a-76f2-454b-920c-605868d88b49'
const PCT30 = 'a02279e4-7498-4e60-aa6a-c01bf6e29267'
const PCT10 = 'fed8365f-3c1b-4ba0-a453-8af671bd0b41'

function coupon(name: string, type: string, value: number, max: number | null = null, scope: string = 'order') {
  return { display_name: name, description: name, code: null, discount_type: type, discount_value: value, max_discount_amount: max, discount_scope: scope }
}

async function call(id: string) {
  const { GET } = await import('../../routes/api/cms/reservations/[id]/order-coupons/+server')
  return (await GET({ params: { id }, locals: {} } as never)) as unknown as { body: Record<string, unknown>; status: number }
}

describe('order-coupons API', () => {
  beforeEach(() => {
    mockGetCmsRoleForAction.mockReset()
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    db = { orderItem: null, order: null, orderCoupons: [], legacy: null }
    firstDayBaseRpc = 35000
  })

  it('다중쿠폰: 조이서 주문 45 — 정액 10,000 + 30% + 방문 10%(1일차) → 단계·합계가 저장값(20,000)과 일치', async () => {
    db.orderItem = { order_id: 45 }
    db.order = { total_amount: '35000.00', delivery_fee: 0, coupon_discount_amount: '20000.00', selected_coupon_id: null }
    db.orderCoupons = [
      { coupon_id: PCT10, coupons: coupon('방문 픽업·반납 (1일차 10%할인)', 'percentage', 10, null, 'first_day') },
      { coupon_id: FIXED, coupons: coupon('리뷰이벤트 [10,000P] 증정', 'fixed', 10000) },
      { coupon_id: PCT30, coupons: coupon('[2026년 한정] 첫 렌탈 미친 할인 30%', 'percentage', 30) },
    ]
    const r = await call('236')
    expect(r.status).toBe(200)
    const steps = r.body.steps as Array<{ name: string; baseAmount: number; discountAmount: number; balanceAfter: number }>
    expect(steps.map(s => s.name)).toEqual(['리뷰이벤트 [10,000P] 증정', '[2026년 한정] 첫 렌탈 미친 할인 30%', '방문 픽업·반납 (1일차 10%할인)'])
    expect(steps.map(s => s.discountAmount)).toEqual([10000, 7500, 2500])
    expect(steps.map(s => s.balanceAfter)).toEqual([25000, 17500, 15000])
    expect(r.body.totalDiscount).toBe(20000)
    expect(r.body.storedDiscount).toBe(20000)
    expect(r.body.finalBalance).toBe(15000)
    expect(r.body.consistent).toBe(true)
  })

  it('저장된 할인액과 화면 계산이 다르면 consistent=false(안내용)', async () => {
    db.orderItem = { order_id: 45 }
    db.order = { total_amount: 35000, delivery_fee: 0, coupon_discount_amount: 10000, selected_coupon_id: null }
    db.orderCoupons = [{ coupon_id: FIXED, coupons: coupon('정액', 'fixed', 10000) }, { coupon_id: PCT30, coupons: coupon('30%', 'percentage', 30) }]
    const r = await call('236')
    expect(r.body.totalDiscount).toBe(17500)
    expect(r.body.storedDiscount).toBe(10000)
    expect(r.body.consistent).toBe(false)
  })

  it('구 단일쿠폰 주문(order_coupons 없음, selected_coupon_id 있음): 단일 쿠폰 1단계로 계산', async () => {
    db.orderItem = { order_id: 7 }
    db.order = { total_amount: 50000, delivery_fee: 0, coupon_discount_amount: 5000, selected_coupon_id: 'uc-1' }
    db.legacy = { coupon_id: PCT10, coupons: coupon('10% 쿠폰', 'percentage', 10) }
    const r = await call('100')
    const steps = r.body.steps as Array<{ discountAmount: number }>
    expect(steps).toHaveLength(1)
    expect(steps[0].discountAmount).toBe(5000)
    expect(r.body.consistent).toBe(true)
  })

  it('주문에 연결되지 않은 예약은 빈 목록(에러 아님)', async () => {
    db.orderItem = null
    const r = await call('5')
    expect(r.status).toBe(200)
    expect(r.body.steps).toEqual([])
    expect(r.body.orderId).toBeNull()
  })

  it('쿠폰이 하나도 없는 주문은 빈 단계·할인 0·일치', async () => {
    db.orderItem = { order_id: 9 }
    db.order = { total_amount: 30000, delivery_fee: 0, coupon_discount_amount: 0, selected_coupon_id: null }
    const r = await call('50')
    expect(r.body.steps).toEqual([])
    expect(r.body.totalDiscount).toBe(0)
    expect(r.body.consistent).toBe(true)
  })

  it('비CMS 호출은 401, 잘못된 예약 id는 400', async () => {
    mockGetCmsRoleForAction.mockResolvedValue(null)
    expect((await call('236')).status).toBe(401)
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    expect((await call('abc')).status).toBe(400)
    expect((await call('0')).status).toBe(400)
  })
})
