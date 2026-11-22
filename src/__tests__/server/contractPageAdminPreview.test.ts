import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /contract/[token] 로드 — ?adminPreview=1 정책.
 *  · manager 이상 CMS 로그인만 미리보기로 인정 → 고객 열람 기록(viewed_at·감사로그 viewed)을 남기지 않는다.
 *  · 고객(역할 없음)·partner 가 파라미터를 붙여도 무효 → 열람 기록이 정상으로 남는다.
 */
type TableResult = { data: unknown }
let tables: Record<string, TableResult> = {}
let updates: Array<{ table: string; payload: unknown }> = []
let role: string | null = null
const auditCalls: unknown[] = []

function chain(table: string): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: TableResult) => unknown) => Promise.resolve(tables[table] ?? { data: [] }).then(res)
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(tables[table] ?? { data: null })
      if (prop === 'update') return (payload: unknown) => { updates.push({ table, payload }); return proxy }
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t), rpc: async () => ({ data: null }) }) }))
vi.mock('$lib/contract-signature/auditLog', () => ({ recordAuditLog: async (_c: unknown, e: unknown) => { auditCalls.push(e) } }))
vi.mock('$lib/services/serviceInfoSettings', () => ({ getServiceInfoSettings: async () => ({}) }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => role }))

import { load } from '../../routes/contract/[token]/+page.server'

const signing = {
  id: 's1', token: 'tok', sent_at: '2026-11-22T00:00:00Z', viewed_at: null, signed_at: '2026-11-22T00:01:00Z', expires_at: '2099-01-01T00:00:00Z',
  contracts: {
    id: 'c1', title: 't', content_blocks: [], specifications: [], document_url: null, reservation_id: 461, authoring_mode: 'html',
    canvas_document: null, spreadsheet_document: null, html_document: '<p>x</p>',
    rental_reservations: { id: 461, status: 'hold', start_date: '2026-12-06', end_date: '2026-12-08', reservation_code: 'X', user_id: 'u1', pickup_method: null, return_method: null, pickup_time: null, return_time: null, products: null },
  },
}

async function run(query: string): Promise<Record<string, unknown>> {
  const event = { params: { token: 'tok' }, url: new URL(`http://localhost/contract/tok${query}`), locals: {} }
  return (await load(event as unknown as Parameters<typeof load>[0])) as Record<string, unknown>
}

beforeEach(() => {
  tables = { contract_signings: { data: signing } }
  updates = []
  auditCalls.length = 0
  role = null
})

describe('/contract/[token] adminPreview', () => {
  it('manager 이상 + ?adminPreview=1 → adminPreview=true, viewed_at·감사로그 미기록', async () => {
    role = 'manager'
    const r = await run('?adminPreview=1')
    expect(r.adminPreview).toBe(true)
    expect(updates.filter((u) => u.table === 'contract_signings')).toHaveLength(0)
    expect(auditCalls).toHaveLength(0)
  })

  it('고객(역할 없음)이 ?adminPreview=1 을 붙여도 무효 → 열람 기록이 정상으로 남는다', async () => {
    role = null
    const r = await run('?adminPreview=1')
    expect(r.adminPreview).toBe(false)
    expect(updates.some((u) => u.table === 'contract_signings' && 'viewed_at' in (u.payload as object))).toBe(true)
    expect(auditCalls).toHaveLength(1)
  })

  it('partner(매니저 미만)도 무효', async () => {
    role = 'partner'
    expect((await run('?adminPreview=1')).adminPreview).toBe(false)
    expect(auditCalls).toHaveLength(1)
  })

  it('파라미터가 없으면 manager 라도 일반 열람(기록 남김)', async () => {
    role = 'manager'
    expect((await run('')).adminPreview).toBe(false)
    expect(auditCalls).toHaveLength(1)
  })
})
