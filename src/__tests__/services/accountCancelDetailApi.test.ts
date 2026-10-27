import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * GET /api/account/payments/cancel-detail — 고객 카드 취소내역 (2026-10-26)
 * 401 / 타인 예약 403 / 결제 없음·취소 아님 404 / 토스 요약 / 토스 실패 시 DB 대체 / 민감 필드 비노출
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({ env: { TOSS_SECRET_KEY: 'toss-secret-key' } }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({ status: init?.status ?? 200, headers: init?.headers ?? {}, async json() { return data } }),
}))

const RECEIPT = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=x&ref=PX'
let reservationOwner = 'user-1'
let txRow: Record<string, unknown> | null = null
let txOwner: string | null = 'user-1'
/** 취소 결제보다 더 최신인 다른 결제 행(실패·대기 등) — 최신순 조회에서 먼저 나온다 */
let newerTx: Record<string, unknown> | null = null

function table(name: string) {
  const inFilters: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, order: () => q, limit: () => q,
    in: (k: string, vals: unknown[]) => { inFilters.push([k, vals]); return q },
    maybeSingle: async () => {
      if (name === 'rental_reservations') return { data: { user_id: reservationOwner }, error: null }
      if (name === 'payment_transactions') {
        // 최신순: newerTx(있으면) → txRow. in('status', …) 필터가 걸리면 그 상태만 통과
        let rows = [newerTx, txRow ? { ...txRow, user_id: txOwner } : null].filter((r): r is Record<string, unknown> => !!r)
        for (const [k, vals] of inFilters) if (k === 'status') rows = rows.filter(r => vals.includes(r.status))
        return { data: rows[0] ?? null, error: null }
      }
      return { data: null, error: null }
    },
  }
  return q
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (n: string) => table(n) }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as typeof global.fetch

const locals = (uid: string | null = 'user-1') => ({
  safeGetSession: async () => ({ session: uid ? { user: { id: uid } } : null }),
})
const call = async (uid: string | null, id: string | null = '77') => {
  const { GET } = await import('../../routes/api/account/payments/cancel-detail/+server')
  const url = new URL('https://x.test/api/account/payments/cancel-detail' + (id ? `?reservationId=${id}` : ''))
  return GET({ locals: locals(uid), url } as never) as unknown as Promise<{ status: number; headers: Record<string, string>; json: () => Promise<Record<string, unknown>> }>
}

const cancelledTx = () => ({
  order_id: 'ord', payment_key: 'pk_secret_key_1', status: 'cancelled', total_amount: 50000, paid_amount: 45000,
  pg_cancelled_at: null, cancelled_at: '2026-10-20T00:00:00Z', cancel_reason: '단순 변심',
  toss_response: { receipt: { url: RECEIPT }, secret: 'ps_secret', card: { number: '4330********' } },
})

beforeEach(() => {
  vi.clearAllMocks()
  reservationOwner = 'user-1'
  txOwner = 'user-1'
  newerTx = null
  txRow = cancelledTx()
})

describe('카드 취소내역 API', () => {
  it('CD-1 세션 없음 → 401', async () => {
    expect((await call(null)).status).toBe(401)
  })
  it('CD-2 예약 ID 형식 오류 → 400', async () => {
    expect((await call('user-1', 'abc')).status).toBe(400)
    expect((await call('user-1', null)).status).toBe(400)
  })
  it('CD-3 타인 예약 → 403 (토스 미호출)', async () => {
    reservationOwner = 'other'
    expect((await call('user-1')).status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('CD-4 결제 행 소유자가 다르거나 비어 있으면 → 403 (fail-closed)', async () => {
    txOwner = 'other'
    expect((await call('user-1')).status).toBe(403)
    txOwner = null
    expect((await call('user-1')).status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('CD-5 결제가 없거나 취소 상태가 아니면 → 404', async () => {
    txRow = null
    expect((await call('user-1')).status).toBe(404)
    txRow = { ...cancelledTx(), status: 'done' }
    expect((await call('user-1')).status).toBe(404)
  })
  it('CD-6 토스 조회 성공 → 승인취소·시각·금액, 민감 필드 비노출', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'CANCELED', totalAmount: 45000, cancels: [{ cancelAmount: 45000, canceledAt: '2026-10-20T09:30:00+09:00', cancelReason: '고객 요청', cancelStatus: 'DONE' }] }),
    })
    const res = await call('user-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, detail: { status: '승인취소', cancelAmount: 45000, balanceAmount: 0, source: 'toss', receiptUrl: RECEIPT } })
    expect(JSON.stringify(body)).not.toContain('고객 요청')
    const json = JSON.stringify(body)
    for (const leak of ['pk_secret_key_1', 'ps_secret', '4330', 'toss-secret-key']) expect(json).not.toContain(leak)
  })
  it('CD-7 토스 조회 실패 → DB 값으로 대체(source=db)', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const body = await (await call('user-1')).json()
    expect(body).toMatchObject({ ok: true, detail: { status: '승인취소', cancelAmount: 45000, source: 'db' } })
    expect(JSON.stringify(body)).not.toContain('단순 변심')
  })
  it('CD-8 토스가 HTTP 오류로 답해도 DB 값으로 대체', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'not found' }) })
    const body = await (await call('user-1')).json()
    expect((body.detail as { source: string }).source).toBe('db')
  })
  it('CD-9 전액 취소 + DB 에 PG 취소 시각이 있으면 토스를 호출하지 않고 DB 값 사용', async () => {
    txRow = { ...cancelledTx(), pg_cancelled_at: '2026-10-20T00:00:00Z' }
    const res = await call('user-1')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ ok: true, detail: { status: '승인취소', cancelledAt: '2026-10-20T00:00:00Z', source: 'db' } })
  })
  it('CD-10 부분취소는 항상 토스에 조회한다', async () => {
    txRow = { ...cancelledTx(), status: 'partial_cancelled', pg_cancelled_at: '2026-10-20T00:00:00Z' }
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'PARTIAL_CANCELED', totalAmount: 45000, cancels: [{ cancelAmount: 10000, canceledAt: '2026-10-20T09:30:00+09:00', cancelStatus: 'DONE' }] }) })
    const body = await (await call('user-1')).json()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ ok: true, detail: { status: '부분취소', cancelAmount: 10000, balanceAmount: 35000, source: 'toss' } })
  })
  it('CD-11 토스 호출은 리디렉트를 따라가지 않고, 모든 응답에 캐시 금지 헤더', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'CANCELED', totalAmount: 45000, cancels: [] }) })
    const ok = await call('user-1')
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(ok.headers['Cache-Control']).toBe('no-store')
    expect((await call(null)).headers['Cache-Control']).toBe('no-store')
    reservationOwner = 'other'
    expect((await call('user-1')).headers['Cache-Control']).toBe('no-store')
  })
  it('CD-12 취소 결제보다 더 최신인 실패·대기 행이 있어도 취소 결제를 기준으로 조회한다(목록과 같은 선택 규칙)', async () => {
    newerTx = { ...cancelledTx(), status: 'failed', payment_key: 'pk_failed', user_id: 'user-1', toss_response: null }
    const res = await call('user-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, detail: { status: '승인취소', receiptUrl: RECEIPT } })
  })
  it('CD-13 [소스 가드] 결제 행 조회는 user_id 를 select 하고 settledOnly 상태 필터를 가진다', () => {
    const src = readFileSync('src/lib/server/findOrderPaymentTransaction.ts', 'utf8')
    // 소유 확인(fail-closed)의 전제 — select 에서 user_id 가 빠지면 모든 요청이 403 이 된다
    expect(src).toMatch(/order_id,\s*user_id,/)
    expect(src).toContain("in('status', SETTLED_STATUSES)")
  })
})
