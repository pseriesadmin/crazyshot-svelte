import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { autoIssueContractOnApproval } from '$lib/server/contractAutoIssue'

/**
 * 예약별 계약 특약(#720) 읽기 규칙의 동작 테스트(2026-10-18) — contractSpecsReadRules.test.ts(정적 검사)를 보완한다.
 *  ① GET /contract-specs: 컬럼 없음(42703)만 빈 목록, 그 밖의 오류는 500, 정상은 저장값 반환
 *  ② 자동발행: 주문 내 대표 행(id 최솟값)의 특약을 쓰되 취소·만료 예약은 제외
 */

// ── ① GET 핸들러 ──
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))

let dbResult: { data: unknown; error: { code?: string; message?: string } | null } = { data: null, error: null }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => dbResult }) }) }),
  }),
}))

beforeEach(() => { dbResult = { data: null, error: null } })

async function callGet() {
  const { GET } = await import('../../routes/api/cms/reservations/[id]/contract-specs/+server')
  return GET({ params: { id: '10' }, locals: {} } as never)
}

describe('GET /api/cms/reservations/[id]/contract-specs', () => {
  it('저장된 특약을 돌려준다', async () => {
    dbResult = { data: { contract_specifications: [{ key: '특약', value: '내용' }] }, error: null }
    const res = await callGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ specifications: [{ key: '특약', value: '내용' }] })
  })

  it('컬럼이 없는 환경(오류 코드 42703)은 빈 목록으로 응답한다', async () => {
    dbResult = { data: null, error: { code: '42703', message: 'column rental_reservations.contract_specifications does not exist' } }
    const res = await callGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ specifications: [] })
  })

  it('컬럼명이 메시지에 들어 있어도 코드가 다르면(일시 오류) 500 — 빈 목록으로 숨기지 않는다', async () => {
    dbResult = { data: null, error: { code: '57014', message: 'canceling statement while reading contract_specifications' } }
    const res = await callGet()
    expect(res.status).toBe(500)
    expect((await res.json()) as { error: string }).toHaveProperty('error')
  })

  it('코드 없는 일반 오류도 500', async () => {
    dbResult = { data: null, error: { message: 'network error' } }
    expect((await callGet()).status).toBe(500)
  })
})

// ── ② 자동발행 특약 선택 ──
interface Row { id: number; status: string; contract_specifications: unknown }

function fakeAdmin(rows: Row[]): SupabaseClient {
  const ids = rows.map((r) => r.id)
  const chain = (table: string) => {
    const api: Record<string, unknown> = {}
    const ret = () => api
    for (const k of ['select', 'eq', 'is', 'in', 'limit']) api[k] = ret
    api['maybeSingle'] = async () => {
      if (table === 'contract_templates') return { data: TEMPLATE, error: null }
      if (table === 'order_items') return { data: { order_id: 9 }, error: null }
      return { data: null, error: null }
    }
    ;(api as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (table === 'order_items') resolve({ data: ids.map((r) => ({ reservation_id: r })), error: null })
      else if (table === 'rental_reservations') resolve({ data: rows, error: null })
      else resolve({ data: [], error: null })
    }
    return api
  }
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient
}

const TEMPLATE = {
  id: 't1', title: '표준 대여계약서',
  content_blocks: [{ type: 'tiptap-doc', doc: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } }],
  specifications: [{ key: '양식특약', value: 'A' }],
  authoring_mode: 'flow', requires_issuer_signature: false,
  canvas_document: null, spreadsheet_document: null, html_document: null,
  html_issuer_signature_url: null, html_issuer_signature_width: null, html_issuer_signature_offset_x: null, html_issuer_signature_offset_y: null,
  contract_terms_text: null, privacy_terms_text: null,
}

function fakeFetch() {
  const bodies: Array<{ specifications?: Array<{ key: string; value: string }> }> = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/contract-data')) return j({ 고객이름: '홍길동' })
    if (url.endsWith('/init-contract')) return j({ contractId: 'c-new' })
    if (url.endsWith('/content') && method === 'PATCH') { bodies.push(JSON.parse(String(init?.body))); return j({ ok: true }) }
    if (url.endsWith('/send-chat')) return j({ ok: true })
    return j({}, 404)
  })
  return { fn: fn as unknown as typeof fetch, bodies }
}

async function issuedSpecs(rows: Row[], reservationId: number) {
  const { fn, bodies } = fakeFetch()
  const r = await autoIssueContractOnApproval({ admin: fakeAdmin(rows), fetch: fn, now: new Date('2026-10-18T01:00:00Z') }, reservationId)
  expect(r).toMatchObject({ status: 'sent' })
  return (bodies[0]?.specifications ?? []).map((s) => s.value)
}

const S = (v: string) => [{ key: '예약특약', value: v }]

describe('자동발행 — 예약 특약 선택', () => {
  it('승인 대상이 대표 행이 아니어도 대표 행(id 최솟값)의 특약을 쓴다', async () => {
    const rows: Row[] = [
      { id: 10, status: 'hold', contract_specifications: S('대표') },
      { id: 11, status: 'hold', contract_specifications: S('형제') },
    ]
    expect(await issuedSpecs(rows, 11)).toEqual(['A', '대표'])
  })

  it('대표 행에 특약이 없으면 특약이 있는 다음 예약의 값을 쓴다', async () => {
    const rows: Row[] = [
      { id: 10, status: 'hold', contract_specifications: null },
      { id: 11, status: 'hold', contract_specifications: S('형제') },
    ]
    expect(await issuedSpecs(rows, 10)).toEqual(['A', '형제'])
  })

  it('id가 가장 작은 예약이 취소됐으면 그 옛 특약을 쓰지 않고 활성 대표 행의 특약을 쓴다', async () => {
    const rows: Row[] = [
      { id: 9, status: 'cancelled', contract_specifications: S('취소된 옛 특약') },
      { id: 10, status: 'hold', contract_specifications: S('활성') },
    ]
    expect(await issuedSpecs(rows, 10)).toEqual(['A', '활성'])
  })

  it('만료된 예약의 특약도 제외한다', async () => {
    const rows: Row[] = [
      { id: 9, status: 'expired', contract_specifications: S('만료된 옛 특약') },
      { id: 10, status: 'hold', contract_specifications: null },
    ]
    expect(await issuedSpecs(rows, 10)).toEqual(['A'])
  })

  it('활성 예약이 하나도 없으면 전체에서 고른다', async () => {
    const rows: Row[] = [
      { id: 9, status: 'cancelled', contract_specifications: S('옛 특약') },
      { id: 10, status: 'expired', contract_specifications: null },
    ]
    expect(await issuedSpecs(rows, 10)).toEqual(['A', '옛 특약'])
  })
})
