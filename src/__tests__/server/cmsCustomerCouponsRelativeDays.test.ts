import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/cms/customers/[id]/coupons — relative_days/unlimited 쿠폰 누락 결함 회귀 테스트
 * (2026-09-21, Stephen 지시: "다음 채팅 세션에서 CMS 관리자 '고객 쿠폰함' 팝업이 이번
 * 방식 쿠폰을 아예 안 보여주는 별도의 오래된 결함" 확인·보완)
 *
 * 원인: validity_type이 'unlimited'·'relative_days'인 쿠폰은 coupons.valid_from/
 * valid_until이 항상 NULL(Migration #512/514/515/520/521)인데, 이 엔드포인트가 SQL에서
 * .lte('coupons.valid_from', now)/.gte('coupons.valid_until', now)로 직접 비교해 NULL과의
 * 부등호 비교가 매번 매칭 실패로 평가되어 두 타입 쿠폰이 통째로 안 보였다. 고객 본인 화면
 * (loadUserCoupons.ts)은 이미 SQL 필터 대신 JS에서 relative_days만 만료 판정하는 방식이라
 * 이 문제가 없었음 — 이 테스트는 관리자 엔드포인트도 동일하게 고쳐졌는지 고정한다.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

type QueryResult = { data: unknown; error?: unknown }

function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

let mockAdmin: { from: ReturnType<typeof vi.fn> }
let queryResult: QueryResult

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdmin,
}))

const { GET } = await import('../../routes/api/cms/customers/[id]/coupons/+server')

const USER_ID = 'customer-uid'

function makeEvent() {
  return {
    locals: {},
    params: { id: USER_ID },
  } as unknown as Parameters<typeof GET>[0]
}

function setup(rows: unknown[]) {
  queryResult = { data: rows }
  mockAdmin = { from: vi.fn(() => makeChain(queryResult)) }
  mockGetCmsRoleForAction.mockResolvedValue('manager')
}

describe('/api/cms/customers/[id]/coupons — relative_days/unlimited 노출 회귀', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('relative_days 쿠폰(아직 첫 확인 전, first_viewed_at NULL) — 목록에 포함됨(상시 표시)', async () => {
    setup([
      {
        id: 'uc-1',
        used_at: null,
        redeemed_code: null,
        first_viewed_at: null,
        coupons: {
          code: null,
          discount_type: 'fixed',
          discount_value: 3000,
          display_name: '첫 확인 3일 쿠폰',
          valid_until: null,
          min_purchase_amount: 0,
          validity_type: 'relative_days',
          valid_days: 3,
        },
      },
    ])
    const result = (await GET(makeEvent())) as unknown as { status: number; data: Array<{ id: string; validUntil: string | null }> }
    expect(result.status).toBe(200)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('uc-1')
    expect(result.data[0].validUntil).toBeNull()
  })

  it('relative_days 쿠폰(첫 확인 후 유효기간 내) — 포함되고 validUntil이 first_viewed_at+valid_days로 계산됨', async () => {
    const firstViewed = new Date(Date.now() - 1 * 86400_000).toISOString() // 1일 전 확인
    setup([
      {
        id: 'uc-2',
        used_at: null,
        redeemed_code: null,
        first_viewed_at: firstViewed,
        coupons: {
          code: null,
          discount_type: 'fixed',
          discount_value: 5000,
          display_name: '3일 한정 쿠폰',
          valid_until: null,
          min_purchase_amount: 0,
          validity_type: 'relative_days',
          valid_days: 3,
        },
      },
    ])
    const result = (await GET(makeEvent())) as unknown as { status: number; data: Array<{ id: string; validUntil: string | null }> }
    expect(result.data).toHaveLength(1)
    const expected = new Date(new Date(firstViewed).getTime() + 3 * 86400_000).toISOString()
    expect(result.data[0].validUntil).toBe(expected)
  })

  it('relative_days 쿠폰(첫 확인 후 유효기간 만료) — 목록에서 제외됨', async () => {
    const firstViewed = new Date(Date.now() - 10 * 86400_000).toISOString() // 10일 전 확인
    setup([
      {
        id: 'uc-3',
        used_at: null,
        redeemed_code: null,
        first_viewed_at: firstViewed,
        coupons: {
          code: null,
          discount_type: 'fixed',
          discount_value: 5000,
          display_name: '3일 한정 쿠폰(만료)',
          valid_until: null,
          min_purchase_amount: 0,
          validity_type: 'relative_days',
          valid_days: 3,
        },
      },
    ])
    const result = (await GET(makeEvent())) as unknown as { status: number; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })

  it('unlimited 쿠폰(valid_from/valid_until 둘 다 NULL) — 목록에 포함됨(회귀: 예전엔 SQL 필터로 누락됐음)', async () => {
    setup([
      {
        id: 'uc-4',
        used_at: null,
        redeemed_code: null,
        first_viewed_at: null,
        coupons: {
          code: 'WELCOME1000',
          discount_type: 'fixed',
          discount_value: 1000,
          display_name: '상시 쿠폰',
          valid_until: null,
          min_purchase_amount: 0,
          validity_type: 'unlimited',
          valid_days: null,
        },
      },
    ])
    const result = (await GET(makeEvent())) as unknown as { status: number; data: Array<{ id: string }> }
    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('uc-4')
  })

  it('fixed_period(절대 기간) 쿠폰 — 기존과 동일하게 정상 표시(display_name 라벨 사용)', async () => {
    setup([
      {
        id: 'uc-5',
        used_at: null,
        redeemed_code: null,
        first_viewed_at: null,
        coupons: {
          code: 'SUMMER10',
          discount_type: 'percentage',
          discount_value: 10,
          display_name: '여름맞이 10%',
          valid_until: new Date(Date.now() + 30 * 86400_000).toISOString(),
          min_purchase_amount: 10000,
          validity_type: 'fixed_period',
          valid_days: null,
        },
      },
    ])
    const result = (await GET(makeEvent())) as unknown as { status: number; data: Array<{ label: string }> }
    expect(result.data).toHaveLength(1)
    expect(result.data[0].label).toBe('여름맞이 10%')
  })
})
