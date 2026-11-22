import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 서명 완료 + 결제 전(hold) 예약은 고객 열람 페이지(/account/rental/[id]/contract)가
 * 서명 링크(/contract/[token])로 보내 결제를 이어가게 한다. 만료·결제완료 건은 열람 유지.
 */
type TableResult = { data: unknown }
let tables: Record<string, TableResult> = {}

function chain(table: string): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve(tables[table] ?? { data: null })
  c.then = (res: (v: TableResult) => unknown) => Promise.resolve(tables[table] ?? { data: null }).then(res)
  return c
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t), storage: { from: () => ({}) } }) }))
vi.mock('$lib/contract-signature/auditLog', () => ({ recordAuditLog: async () => undefined }))
vi.mock('$lib/services/serviceInfoSettings', () => ({ getServiceInfoSettings: async () => ({}) }))
vi.mock('$lib/server/contractArchive/loadArchivedPdf', () => ({ findCurrentFinalDocument: async () => null }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))

import { load } from '../../routes/account/rental/[id]/contract/+page.server'

const signing = {
  id: 's1', token: 'tok-abc', signed_at: '2026-11-22T00:18:11Z', ip_address: null, signature_data: null, stroke_count: 0,
  signed_content_snapshot: null,
  contracts: { id: 'c1', title: 't', content_blocks: [], specifications: [], authoring_mode: null, canvas_document: null, spreadsheet_document: null, html_document: null, reservation_id: 461 },
}

function event() {
  return {
    params: { id: '461' },
    url: new URL('http://localhost/account/rental/461/contract'),
    locals: {
      safeGetSession: async () => ({ session: { user: { id: 'u1' } } }),
      supabase: { from: () => chain('own_reservation') },
    },
  } as unknown as Parameters<typeof load>[0]
}

async function run(): Promise<unknown> {
  try { return await load(event()) } catch (e) { return e }
}

beforeEach(() => {
  tables = {
    own_reservation: { data: { id: 461, reservation_code: 'X', start_date: '', end_date: '', pickup_method: null, return_method: null, pickup_time: null, return_time: null, products: null } },
    order_items: { data: { order_id: null } },
    contract_signings: { data: signing },
  }
})

describe('열람 페이지 → 결제 이어가기 리다이렉트', () => {
  it('서명 완료 + hold + 미결제 → /contract/[token] 으로 303', async () => {
    tables.rental_reservations = { data: { status: 'hold', payment_confirmed_at: null } }
    const r = (await run()) as { status?: number; location?: string }
    expect(r.status).toBe(303)
    expect(r.location).toBe('/contract/tok-abc')
  })

  it('만료(expired) 건은 리다이렉트하지 않는다', async () => {
    tables.rental_reservations = { data: { status: 'expired', payment_confirmed_at: null } }
    const r = (await run()) as { status?: number }
    expect(r.status).toBeUndefined()
  })

  it('결제 완료(confirmed) 건은 리다이렉트하지 않는다', async () => {
    tables.rental_reservations = { data: { status: 'confirmed', payment_confirmed_at: '2026-11-22T01:00:00Z' } }
    const r = (await run()) as { status?: number }
    expect(r.status).toBeUndefined()
  })
})
