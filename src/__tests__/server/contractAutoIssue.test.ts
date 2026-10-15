import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { autoIssueContractOnApproval } from '$lib/server/contractAutoIssue'

/**
 * 예약 승인 시 전자계약 자동발행 — 서버 로직(2026-10-15). 관리자 API는 주입한 가짜 fetch 로 대신해
 * 호출 순서(init-contract → PATCH content → send-chat)·치환·건너뛰기 사유를 검증한다.
 */

interface Cfg {
  template?: Record<string, unknown> | null
  existingContract?: boolean
  orderSiblings?: number[]
}

function fakeAdmin(cfg: Cfg): SupabaseClient {
  const chain = (table: string) => {
    const state = { table }
    const api: Record<string, unknown> = {}
    const ret = () => api
    api['select'] = ret
    api['eq'] = ret
    api['is'] = ret
    api['in'] = ret
    api['limit'] = ret
    api['maybeSingle'] = async () => {
      if (state.table === 'contract_templates') return { data: cfg.template ?? null, error: null }
      if (state.table === 'contracts') return { data: cfg.existingContract ? { id: 'c-old' } : null, error: null }
      if (state.table === 'order_items') return { data: cfg.orderSiblings ? { order_id: 9 } : null, error: null }
      return { data: null, error: null }
    }
    // order_items sibling 조회는 maybeSingle 없이 await 된다
    ;(api as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (state.table === 'order_items') resolve({ data: (cfg.orderSiblings ?? []).map((r) => ({ reservation_id: r })), error: null })
      else resolve({ data: [], error: null })
    }
    return api
  }
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient
}

const FLOW_TEMPLATE = {
  id: 't1',
  title: '표준 대여계약서',
  content_blocks: [{ type: 'tiptap-doc', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } }] }] } }],
  specifications: [{ key: '특약', value: '내용' }],
  authoring_mode: 'flow',
  requires_issuer_signature: false,
  canvas_document: null,
  spreadsheet_document: null,
  html_document: null,
  html_issuer_signature_url: null,
  html_issuer_signature_width: null,
  html_issuer_signature_offset_x: null,
  html_issuer_signature_offset_y: null,
  contract_terms_text: null,
  privacy_terms_text: null,
}

interface Call { url: string; method: string; body?: unknown }
function fakeFetch(opts: { dataStatus?: number; sendStatus?: number; sendError?: string; deleteStatus?: number; data?: Record<string, unknown> } = {}) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/contract-data')) return opts.dataStatus && opts.dataStatus !== 200 ? j({ error: 'x' }, opts.dataStatus) : j({ 고객이름: '홍길동', ...(opts.data ?? {}) })
    if (url.endsWith('/init-contract')) return j({ contractId: 'c-new' })
    if (url.endsWith('/content') && method === 'PATCH') return j({ ok: true })
    if (url.endsWith('/content') && method === 'DELETE') return opts.deleteStatus && opts.deleteStatus !== 200 ? j({ error: '발송된 계약서는 비울 수 없습니다' }, opts.deleteStatus) : j({ ok: true })
    if (url.endsWith('/send-chat')) return opts.sendStatus && opts.sendStatus !== 200 ? j({ error: opts.sendError ?? '발송 실패' }, opts.sendStatus) : j({ ok: true })
    return j({}, 404)
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('autoIssueContractOnApproval', () => {
  it('표준양식이 지정되지 않았으면 기능 꺼짐(off) — 아무 API도 부르지 않는다', async () => {
    const { fn, calls } = fakeFetch()
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: null }), fetch: fn }, 10)
    expect(r).toEqual({ status: 'off' })
    expect(calls.length).toBe(0)
  })

  it('이 주문에 이미 계약서가 있으면 건너뛴다', async () => {
    const { fn, calls } = fakeFetch()
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: FLOW_TEMPLATE, existingContract: true, orderSiblings: [10, 11] }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'contract_exists' })
    expect(calls.length).toBe(0)
  })

  it('발행자 서명 필수인데 서명을 충족할 수 없는 양식(문서형)은 계약서를 만들기 전에 건너뛴다', async () => {
    const { fn, calls } = fakeFetch()
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: { ...FLOW_TEMPLATE, requires_issuer_signature: true } }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'issuer_signature_required' })
    expect(calls.length).toBe(0)
  })

  it('예약 데이터 조회가 403이면 권한 안내와 함께 건너뛴다', async () => {
    const { fn, calls } = fakeFetch({ dataStatus: 403 })
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: FLOW_TEMPLATE }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'contract_data_unavailable' })
    expect((r as { message: string }).message).toContain('권한')
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET /api/cms/reservations/10/contract-data'])
  })

  it('문서형 성공: init-contract → 치환된 내용 PATCH → send-chat 순서로 부르고 sent 를 돌려준다', async () => {
    const { fn, calls } = fakeFetch()
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: FLOW_TEMPLATE }), fetch: fn, now: new Date('2026-10-15T01:00:00Z') }, 10)
    expect(r).toEqual({ status: 'sent', contractId: 'c-new', templateTitle: '표준 대여계약서' })
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET /api/cms/reservations/10/contract-data',
      'POST /api/cms/reservations/10/init-contract',
      'PATCH /api/cms/contracts/c-new/content',
      'POST /api/cms/contracts/c-new/send-chat',
    ])
    const patch = calls[2]!.body as { title: string; content_blocks: unknown[]; template_id: string; authoring_mode: string; specifications: unknown[] }
    expect(patch.title).toBe('표준 대여계약서')
    expect(patch.template_id).toBe('t1')
    expect(patch.authoring_mode).toBe('flow')
    expect(JSON.stringify(patch.content_blocks)).toContain('홍길동') // {{고객이름}} 칩이 값으로 치환됨
    expect(JSON.stringify(patch.content_blocks)).not.toContain('mergeField')
    expect(patch.specifications).toEqual([{ key: '특약', value: '내용' }])
  })

  it('캔버스형은 내용 블록 없이 canvas_document 를 그대로 저장한다', async () => {
    const { fn, calls } = fakeFetch()
    const canvas = { pages: [], fields: [{ id: 'f1' }] }
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: { ...FLOW_TEMPLATE, authoring_mode: 'canvas', content_blocks: [], canvas_document: canvas } }), fetch: fn }, 10)
    expect(r.status).toBe('sent')
    const patch = calls.find((c) => c.method === 'PATCH')!.body as { authoring_mode: string; canvas_document: unknown; content_blocks: unknown[] }
    expect(patch.authoring_mode).toBe('canvas')
    expect(patch.canvas_document).toEqual(canvas)
    expect(patch.content_blocks).toEqual([])
  })

  it('발송이 실패하면 방금 만든 계약서를 되돌리고(삭제) 건너뛴다', async () => {
    const { fn, calls } = fakeFetch({ sendStatus: 422, sendError: '발행자 서명이 필요합니다' })
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: FLOW_TEMPLATE }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'send_failed' })
    expect((r as { message: string }).message).toContain('발행자 서명이 필요합니다')
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/cms/contracts/c-new/content' })
  })

  it('발송이 일부만 진행돼 되돌리기가 거부되면 "아무것도 안 됐다"고 안내하지 않고 확인을 요청한다', async () => {
    const { fn } = fakeFetch({ sendStatus: 500, sendError: '채팅 전달 실패', deleteStatus: 400 })
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: FLOW_TEMPLATE }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'send_failed' })
    expect((r as { message: string }).message).toContain('일부만 발행')
    expect((r as { message: string }).message).toContain('계약서')
  })

  it('HTML 양식에서 채워지지 않은 항목이 있으면 계약서를 만들지 않고 건너뛴다', async () => {
    const { fn, calls } = fakeFetch()
    const r = await autoIssueContractOnApproval({ admin: fakeAdmin({ template: { ...FLOW_TEMPLATE, authoring_mode: 'html', content_blocks: [] } }), fetch: fn }, 10)
    expect(r).toMatchObject({ status: 'skipped', reason: 'unresolved_variables' })
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET /api/cms/reservations/10/contract-data'])
  })
})
