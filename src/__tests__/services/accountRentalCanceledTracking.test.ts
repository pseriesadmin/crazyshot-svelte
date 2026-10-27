import { describe, it, expect, vi } from 'vitest'

/**
 * 두발히어로에서 취소된 접수번호는 마이페이지 카드·단계 설명에 운송장으로 나오면 안 된다 (2026-10-27)
 * (취소돼도 tracking_number 는 남아 있고 dhero_meta.canceledAt 으로만 구분된다 — CMS 재접수 시 새 번호로 바뀜)
 */
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'a' }))
vi.mock('$lib/server/account/loadRentalContractStatus', () => ({ loadRentalContractStatus: async () => new Map() }))
vi.mock('$lib/server/account/loadPaymentReceipts', () => ({ loadPaymentReceipts: async () => new Map(), pickCardPayment: () => null }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))
vi.mock('$lib/server/cancelPolicyLoader', () => ({
  loadCancelKinds: async () => new Map(),
  loadCancelRequestedIds: async () => new Set(),
  loadReservationOrderIds: async () => new Map(),
}))

import { load } from '../../routes/account/rental/+page.server'

interface Row { id: number; tracking_number: string | null; courier_code: string | null; dhero_meta: Record<string, unknown> | null }

const row = (r: Row) => ({
  id: r.id, status: 'shipped', reservation_code: `CS-${r.id}`, start_date: '2026-11-05', end_date: '2026-11-06',
  return_method: null, return_time: null, created_at: '2026-10-27T00:00:00Z', product_id: 1,
  tracking_number: r.tracking_number, courier_code: r.courier_code, dhero_meta: r.dhero_meta, pickup_method: 'crazydelivery', pickup_time: null,
  customer_cancelled_at: null, cancel_confirmed_at: null, cancel_requested_at: null, products: { name: '카메라', category: '카메라' },
})

const run = async (rows: Row[]) => {
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'or', 'order']) chain[k] = () => chain
  chain.limit = async () => ({ data: rows.map(row), error: null })
  const result = await (load as unknown as (e: unknown) => Promise<{ rentals: Array<{ tracking_number: string | null; courier_code: string | null; journeyDetails: Record<string, string[]> }> }>)({
    locals: { safeGetSession: async () => ({ session: { user: { id: 'u1' } } }), supabase: { from: () => chain } },
    url: new URL('https://crazyshot.kr/account/rental'),
  })
  return result.rentals
}

describe('/account/rental — 두발히어로 취소 접수번호 숨김', () => {
  it('CT-1 취소된 두발히어로 접수는 운송장·택배사를 내려보내지 않는다', async () => {
    const [r] = await run([{ id: 1, tracking_number: 'CS-1', courier_code: '두발히어로', dhero_meta: { canceledAt: '2026-10-27T01:00:00Z' } }])
    expect(r.tracking_number).toBeNull()
    expect(r.courier_code).toBeNull()
    expect(JSON.stringify(r.journeyDetails)).not.toContain('CS-1')
  })
  it('CT-2 살아 있는 두발히어로 접수는 그대로 보인다', async () => {
    const [r] = await run([{ id: 2, tracking_number: 'CS-2', courier_code: '두발히어로', dhero_meta: {} }])
    expect(r.tracking_number).toBe('CS-2')
    expect(r.courier_code).toBe('두발히어로')
  })
  it('CT-3 다른 택배사 운송장은 canceledAt 과 무관하게 보인다', async () => {
    const [r] = await run([{ id: 3, tracking_number: '123456', courier_code: 'CJ대한통운', dhero_meta: { canceledAt: '2026-10-27T01:00:00Z' } }])
    expect(r.tracking_number).toBe('123456')
  })
})

// /account(PC 패널) 로더도 같은 기준 — sp3 지적(2026-10-27)
describe('/account 로더 — 두발히어로 취소 접수번호 숨김(소스 가드)', () => {
  it('CT-4 /account 로더가 dhero_meta 를 읽고 liveDheroBookings 로 운송장을 거른다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/routes/account/+page.server.ts', 'utf8')
    expect(src).toContain("from '$lib/utils/dheroLabels'")
    expect(src).toMatch(/dhero_meta/)
    expect(src).toContain('liveDheroBookings(')
    expect(src).toContain('liveBookingIds.has(')
  })
})
