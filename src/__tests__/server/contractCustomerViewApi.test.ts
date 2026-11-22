import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 관리자 채팅 '고객 입장 화면' 미리보기 — customer-view 엔드포인트.
 * 서명 완료 + hold + 미결제만 고객 화면 주소(?adminPreview=1)를 돌려주고, 그 외는 payable=false.
 */
type TableResult = { data: unknown }
let tables: Record<string, TableResult> = {}
let role: string | null = 'manager'

function chain(table: string): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve(tables[table] ?? { data: null })
  return c
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => role }))

import { GET } from '../../routes/api/cms/contracts/[id]/customer-view/+server'

const signed = { token: 'tok-1', signed_at: '2026-11-22T00:18:11Z', contracts: { reservation_id: 461 } }

async function call(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET({ params: { id: 'c1' }, locals: {} } as unknown as Parameters<typeof GET>[0])
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  role = 'manager'
  tables = { contract_signings: { data: signed }, rental_reservations: { data: { status: 'hold', payment_confirmed_at: null } } }
})

describe('GET /api/cms/contracts/[id]/customer-view', () => {
  it('서명 완료 + hold + 미결제 → 고객 화면 주소(adminPreview) 반환', async () => {
    const r = await call()
    expect(r.body).toEqual({ payable: true, url: '/contract/tok-1?adminPreview=1' })
  })
  it('만료(expired) → payable=false, 주소 없음', async () => {
    tables.rental_reservations = { data: { status: 'expired', payment_confirmed_at: null } }
    expect((await call()).body).toEqual({ payable: false, url: null })
  })
  it('결제 완료(confirmed) → payable=false', async () => {
    tables.rental_reservations = { data: { status: 'confirmed', payment_confirmed_at: '2026-11-22T01:00:00Z' } }
    expect((await call()).body.payable).toBe(false)
  })
  it('미서명 → payable=false', async () => {
    tables.contract_signings = { data: { ...signed, signed_at: null } }
    expect((await call()).body.payable).toBe(false)
  })
  it('partner(매니저 미만)는 403, 토큰 노출 없음', async () => {
    role = 'partner'
    const r = await call()
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).not.toContain('tok-1')
  })
})
