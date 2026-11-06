import { describe, it, expect, vi, beforeEach } from 'vitest'

/** /api/cron/late-fee-notice — 인증, 선점 후 발송, 실패 건 선점 되돌림 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
const envMock: Record<string, string | undefined> = { CRON_SECRET: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'k' }
vi.mock('$env/dynamic/private', () => ({ env: envMock }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))

const rpcMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }) }))

const notifyMock = vi.fn()
vi.mock('$lib/server/lateFeeNotify', () => ({ notifyLateFeeRequested: (...a: unknown[]) => notifyMock(...a) }))

const { GET } = await import('../../routes/api/cron/late-fee-notice/+server')

function ev(auth?: string) {
  return { request: { headers: { get: (k: string) => (k === 'authorization' ? (auth ?? null) : null) } } } as unknown as Parameters<typeof GET>[0]
}
type Res = { status: number; data: Record<string, unknown> }

describe('GET /api/cron/late-fee-notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envMock.CRON_SECRET = 'secret'
    notifyMock.mockResolvedValue(true)
  })

  it('CRON_SECRET 미설정이면 거부한다(fail-closed)', async () => {
    envMock.CRON_SECRET = undefined
    expect(((await GET(ev('Bearer secret'))) as unknown as Res).status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('인증 헤더가 다르면 거부하고 대상 조회도 하지 않는다', async () => {
    expect(((await GET(ev('Bearer nope'))) as unknown as Res).status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('선점한 연체료마다 요청 알림(푸시·문자)을 발송한다', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ late_fee_id: 'f1', rsv_id: 7, amount: '12000', hours: 5 }], error: null })
    const res = (await GET(ev('Bearer secret'))) as unknown as Res
    expect(res.data.succeeded).toBe(1)
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), { lateFeeId: 'f1', reservationId: 7, feeAmount: 12000 })
  })

  it('푸시·문자가 모두 실패해 false 를 받으면 선점을 되돌려 다음 날 다시 시도하고, 같은 실행에서는 다시 집지 않는다', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ late_fee_id: 'nope', rsv_id: 1, amount: 1000, hours: 1 }], error: null })
    rpcMock.mockResolvedValue({ data: null, error: null })
    notifyMock.mockResolvedValueOnce(false)
    const res = (await GET(ev('Bearer secret'))) as unknown as Res
    expect(res.status).toBe(200)
    expect(res.data.failed).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('release_late_fee_notice', { p_late_fee_id: 'nope' })
    // 되돌린 뒤 claim 을 다시 부르지 않는다(claim 1회 + release 1회)
    expect(rpcMock.mock.calls.filter((c) => c[0] === 'claim_late_fees_for_notice')).toHaveLength(1)
  })

  it('발송 중 예외가 나면 그 건도 선점을 되돌리고 나머지는 계속 처리한다', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { late_fee_id: 'bad', rsv_id: 1, amount: 1000, hours: 1 },
        { late_fee_id: 'ok', rsv_id: 2, amount: 2000, hours: 2 },
      ],
      error: null,
    })
    rpcMock.mockResolvedValue({ data: null, error: null })
    notifyMock.mockRejectedValueOnce(new Error('boom'))
    const res = (await GET(ev('Bearer secret'))) as unknown as Res
    expect(res.data.failed).toBe(1)
    expect(res.data.succeeded).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('release_late_fee_notice', { p_late_fee_id: 'bad' })
    expect(rpcMock).not.toHaveBeenCalledWith('release_late_fee_notice', { p_late_fee_id: 'ok' })
  })

  it('대상 조회(claim)가 실패하면 HTTP 500 으로 응답해 조용히 넘어가지 않는다', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'function not found' } })
    const res = (await GET(ev('Bearer secret'))) as unknown as Res
    expect(res.status).toBe(500)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('선점 대상이 없으면 아무것도 발송하지 않는다', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const res = (await GET(ev('Bearer secret'))) as unknown as Res
    expect(res.data.processed).toBe(0)
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
