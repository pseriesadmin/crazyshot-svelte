import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CMS 반납정보(검수 탭) — 같은 주문의 다른 상품 제출 포함 (2026-11-11)
 *
 * 고객 반납 제출은 예약 1건마다 따로 저장되는데(reservation_return_submissions.reservation_id UNIQUE),
 * CMS 목록은 주문 1건 = 1행(대표 예약)이라 대표 예약만 읽으면 다른 상품 제출이 보이지 않았다.
 * → return-evidence API 가 같은 주문 예약의 제출을 sibling_submissions 로 함께 내려준다.
 */
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null) }))
vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
let role = 'manager'
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => role }))
vi.mock('$lib/utils/cmsPermissions', () => ({ hasSettingsAccess: (r: string) => ['manager', 'superadmin'].includes(r) }))
vi.mock('$lib/server/returnInspectionItems', () => ({
  loadReturnInspectionItems: async () => ({ active: [{ key: 'body', label: '본체', customerVisible: true }], labelByKey: new Map([['body', '본체']]) }),
  loadReturnPhotoItems: async () => ({ active: [{ key: 'body', label: '본체 사진' }], labelByKey: new Map([['body', '본체 사진']]) }),
}))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: vi.fn(async () => undefined) }))

type Row = Record<string, unknown>
let orderIdOf: Record<number, number | null> = {}
let orderMembers: Record<number, number[]> = {}
let submissions: Record<number, Row> = {}
let media: Record<number, Row[]> = {}
let errorFor: number | null = null

function chain(table: string) {
  const f: Record<string, unknown> = {}
  let eqCol = '', eqVal: unknown, inCol = '', inVal: unknown[] = []
  const resolve = (): { data: unknown; error: { message: string } | null } => {
    if (table === 'order_items') {
      if (eqCol === 'reservation_id') return { data: orderIdOf[eqVal as number] != null ? { order_id: orderIdOf[eqVal as number] } : null, error: null }
      if (eqCol === 'order_id') return { data: (orderMembers[eqVal as number] ?? []).map((id) => ({ reservation_id: id })), error: null }
    }
    if (table === 'reservation_return_submissions') return errorFor === (eqVal as number) ? { data: null, error: { message: 'boom' } as never } : { data: submissions[eqVal as number] ?? null, error: null }
    if (table === 'reservation_return_media') return { data: media[eqVal as number] ?? [], error: null }
    if (table === 'rental_reservations') {
      if (inCol === 'id') return { data: inVal.map((id) => ({ id, products: { name: `상품${id}` } })), error: null }
      return { data: { status: 'in_use', inspection_status: null, inspected_at: null, has_prior_issue: false }, error: null }
    }
    return { data: [], error: null }
  }
  for (const m of ['select', 'order', 'neq', 'not', 'limit']) f[m] = () => f
  f.eq = (c: string, v: unknown) => { eqCol = c; eqVal = v; return f }
  f.in = (c: string, v: unknown[]) => { inCol = c; inVal = v; return f }
  f.maybeSingle = async () => resolve()
  f.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(res, rej)
  return f
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => chain(t),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })) }) }) },
  }),
}))

const { GET } = await import('../../routes/api/cms/reservations/[id]/return-evidence/+server')
const call = (id: number) => (GET as unknown as (e: unknown) => Promise<{ status: number; data: Record<string, unknown> }>)({ params: { id: String(id) }, locals: {} })

describe('return-evidence — 같은 주문의 다른 상품 제출', () => {
  beforeEach(() => {
    orderIdOf = { 10: 1, 11: 1, 12: 1, 20: null }
    orderMembers = { 1: [10, 11, 12] }
    submissions = {}
    media = {}
    errorFor = null
    role = 'manager'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('대표 예약(10)은 제출이 없고 다른 상품(11)이 제출했으면 sibling_submissions 에 상품 이름과 함께 내려온다', async () => {
    submissions[11] = { id: 111, method: 'courier', checklist: ['body'], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-11T01:00:00Z' }
    media[111] = [{ id: 1, item_key: 'body', storage_path: '11/body/a.jpg', kind: 'photo', sort_order: 0 }]
    const r = await call(10)
    expect(r.status).toBe(200)
    expect(r.data.submission).toBeNull()
    const sibs = r.data.sibling_submissions as { reservation_id: number; product_name: string; groups: { items: { url: string }[] }[] }[]
    expect(sibs).toHaveLength(1)
    expect(sibs[0].reservation_id).toBe(11)
    expect(sibs[0].product_name).toBe('상품11')
    expect(sibs[0].groups[0].items[0].url).toBe('https://signed/11/body/a.jpg')
  })

  it('대표 예약과 다른 상품이 모두 제출했으면 대표는 submission, 나머지는 sibling_submissions 로 구분된다(중복 없음)', async () => {
    submissions[10] = { id: 110, method: 'courier', checklist: [], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-10T01:00:00Z' }
    submissions[12] = { id: 112, method: 'courier', checklist: [], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-11T02:00:00Z' }
    const r = await call(10)
    expect((r.data.submission as { submitted_at: string }).submitted_at).toBe('2026-11-10T01:00:00Z')
    expect((r.data.sibling_submissions as { reservation_id: number }[]).map((s) => s.reservation_id)).toEqual([12])
  })

  it('주문에 속하지 않은 예약은 기존과 같다(sibling_submissions 비어 있음)', async () => {
    submissions[20] = { id: 120, method: 'courier', checklist: [], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-11T03:00:00Z' }
    const r = await call(20)
    expect(r.data.submission).not.toBeNull()
    expect(r.data.sibling_submissions).toEqual([])
  })

  it('어떤 예약도 제출하지 않았으면 submission 이 null 이고 sibling_submissions 도 비어 있다', async () => {
    const r = await call(10)
    expect(r.data.submission).toBeNull()
    expect(r.data.sibling_submissions).toEqual([])
  })

  it('다른 상품 제출 조회가 실패해도 대표 예약 제출은 그대로 내려온다(500 아님, 실패한 상품만 건너뜀)', async () => {
    submissions[10] = { id: 110, method: 'courier', checklist: [], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-10T01:00:00Z' }
    submissions[12] = { id: 112, method: 'courier', checklist: [], locker_number: null, locker_password: null, customer_feedback: null, customer_rating: null, submitted_at: '2026-11-11T02:00:00Z' }
    errorFor = 11
    const r = await call(10)
    expect(r.status).toBe(200)
    expect(r.data.submission).not.toBeNull()
    expect((r.data.sibling_submissions as { reservation_id: number }[]).map((s) => s.reservation_id)).toEqual([12])
  })

  it('대표 예약 자신의 조회가 실패하면 500 이다', async () => {
    errorFor = 10
    expect((await call(10)).status).toBe(500)
  })

  it('파트너에게는 다른 상품 제출의 무인함 비밀번호가 가려지고 매니저에게는 보인다', async () => {
    submissions[11] = { id: 111, method: 'locker', checklist: [], locker_number: '7', locker_password: '1234', customer_feedback: null, customer_rating: null, submitted_at: '2026-11-11T01:00:00Z' }
    role = 'partner'
    const p = await call(10)
    const ps = (p.data.sibling_submissions as { submission: { locker_number: string; locker_password: string | null; locker_password_hidden: boolean } }[])[0].submission
    expect(ps.locker_number).toBe('7')
    expect(ps.locker_password).toBeNull()
    expect(ps.locker_password_hidden).toBe(true)
    role = 'manager'
    const m = await call(10)
    const ms = (m.data.sibling_submissions as { submission: { locker_password: string | null; locker_password_hidden: boolean } }[])[0].submission
    expect(ms.locker_password).toBe('1234')
    expect(ms.locker_password_hidden).toBe(false)
  })
})
