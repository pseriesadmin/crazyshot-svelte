import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  NOT_FOUND_CONFIRM_COUNT,
  NOT_FOUND_SKIP_MS,
  isNotFoundSkipped,
  withNotFoundMark,
} from '$lib/server/dheroSyncNotFound'

/**
 * 두발히어로가 "존재하지 않는 배송건"(404)이라고 답하는 접수번호를 동기화 크론이 10분마다 재조회하던 문제(2026-11-10, Production 테스트 예약 id 335) 방지.
 *  NF-1..4  순수 규칙(연속 횟수·확정·24시간 건너뜀·기존 메타 보존)
 *  NF-5..9  크론 동작(404 표시 저장, 확정 건 건너뜀, 기간 지나면 재조회, 404 아닌 오류는 표시 안 함, 성공하면 표시 사라짐)
 */

describe('dheroSyncNotFound — 순수 규칙', () => {
  const NOW = Date.parse('2026-11-10T12:00:00Z')

  it('NF-1: 404 를 받을 때마다 연속 횟수가 오르고, 확정 횟수에 이르기 전에는 확정 시각이 없다', () => {
    const m1 = withNotFoundMark(null, 'B1', NOW)
    expect(m1).toMatchObject({ syncNotFoundCount: 1, syncNotFoundBookId: 'B1' })
    expect(m1.syncNotFoundAt).toBeUndefined()
    const m2 = withNotFoundMark(m1, 'B1', NOW)
    expect(m2.syncNotFoundCount).toBe(2)
    expect(m2.syncNotFoundAt).toBeUndefined()
  })

  it('NF-2: 확정 횟수에 이르면 확정 시각(ISO)을 기록하고, 그때부터 24시간 건너뛴다', () => {
    const m = withNotFoundMark({ syncNotFoundCount: NOT_FOUND_CONFIRM_COUNT - 1, syncNotFoundBookId: 'B1' }, 'B1', NOW)
    expect(m.syncNotFoundAt).toBe(new Date(NOW).toISOString())
    expect(NOT_FOUND_SKIP_MS).toBe(12 * 60 * 60 * 1000)
    expect(isNotFoundSkipped(m, 'B1', NOW + 1000)).toBe(true)
    expect(isNotFoundSkipped(m, 'B1', NOW + NOT_FOUND_SKIP_MS - 1)).toBe(true)
    expect(isNotFoundSkipped(m, 'B1', NOW + NOT_FOUND_SKIP_MS)).toBe(false) // 기간이 지나면 한 번 다시 조회
  })

  it('NF-3: 기존 메타(상태 응답 등)는 그대로 두고 표시만 덧붙인다', () => {
    const m = withNotFoundMark({ bookId: 'B1', status: 0, canceledAt: null }, 'B1', NOW)
    expect(m).toMatchObject({ bookId: 'B1', status: 0, canceledAt: null, syncNotFoundCount: 1 })
  })

  it('NF-4: 표시가 없거나 값이 깨졌으면 건너뛰지 않는다(조회 쪽으로 안전)', () => {
    expect(isNotFoundSkipped(null, 'B1', NOW)).toBe(false)
    expect(isNotFoundSkipped({}, 'B1', NOW)).toBe(false)
    expect(isNotFoundSkipped({ syncNotFoundBookId: 'B1', syncNotFoundAt: 'not-a-date' }, 'B1', NOW)).toBe(false)
    expect(isNotFoundSkipped({ syncNotFoundBookId: 'B1', syncNotFoundAt: 12345 }, 'B1', NOW)).toBe(false)
    expect(isNotFoundSkipped({ syncNotFoundBookId: 'B1', syncNotFoundAt: new Date(NOW + 60_000).toISOString() }, 'B1', NOW)).toBe(false) // 미래 시각은 무시
    expect(withNotFoundMark({ syncNotFoundCount: 'x', syncNotFoundBookId: 'B1' }, 'B1', NOW).syncNotFoundCount).toBe(1)
  })

  it('NF-4b: 접수번호가 바뀌면 이전 표시는 무효이고 새 번호는 처음부터 센다(낡은 표시가 새 접수번호를 건너뛰게 하지 않는다)', () => {
    const old = { syncNotFoundCount: 3, syncNotFoundBookId: 'OLD', syncNotFoundAt: new Date(NOW).toISOString() }
    expect(isNotFoundSkipped(old, 'OLD', NOW + 1000)).toBe(true)
    expect(isNotFoundSkipped(old, 'NEW', NOW + 1000)).toBe(false)
    expect(isNotFoundSkipped(old, null, NOW + 1000)).toBe(false)
    const next = withNotFoundMark(old, 'NEW', NOW + 2000)
    expect(next).toMatchObject({ syncNotFoundCount: 1, syncNotFoundBookId: 'NEW' })
    expect(next.syncNotFoundAt).toBeUndefined()
  })
})

// ── 크론 동작 ─────────────────────────────────────────────────────────────

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'k', DHERO_API_BASE_URL: 'https://dev', DHERO_TOKEN: 't', DHERO_SPOT_CODE: 's', CRON_SECRET: 'secret' },
}))
const mockAutoAdvance = vi.fn()
vi.mock('$lib/server/dheroAutoAdvance', () => ({ maybeAutoAdvanceOnDheroDelivered: (...a: unknown[]) => mockAutoAdvance(...a) }))

class FakeDheroApiError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); this.name = 'DheroApiError' }
}
const mockGetDelivery = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  DheroApiError: FakeDheroApiError,
  getDeliveryByBookId: (...a: unknown[]) => mockGetDelivery(...a),
  isDheroTerminalStatus: (c: number | null | undefined) => c != null && [5, 6, 7].includes(c),
}))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))

const mockRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a: unknown[]) => mockRpc(...a), from: (...a: unknown[]) => mockFrom(...a) }) }))

function chain(rows: Record<string, unknown>[]) {
  const c: Record<string, unknown> = {}
  c.select = vi.fn().mockReturnValue(c)
  c.not = vi.fn().mockReturnValue(c)
  c.is = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
  return c
}
function setupRows(pickupRows: Record<string, unknown>[]) {
  let n = 0
  mockFrom.mockImplementation(() => (++n === 1 ? chain(pickupRows) : chain([])))
}
async function runCron() {
  const { GET } = await import('../../routes/api/cron/dhero-sync/+server')
  const request = new Request('https://t.com/api/cron/dhero-sync', { headers: { authorization: 'Bearer secret' } })
  return (await GET({ request } as Parameters<typeof GET>[0])).json()
}
const baseRow = {
  id: 335, tracking_number: 'BOOK-335', courier_code: '두발히어로', dhero_return_book_id: null,
  dhero_status: null, dhero_status_code: null, dhero_dong_group: null, dhero_meta: null,
  status: 'return_requested', pickup_method: 'delivery', return_method: 'delivery',
}

describe('cron dhero-sync — 존재하지 않는 배송건(404) 반복 조회 방지', () => {
  beforeEach(() => {
    mockRpc.mockReset().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReset()
    mockGetDelivery.mockReset()
    mockAutoAdvance.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('NF-5: 404 면 접수번호·택배사·기존 상태는 그대로 두고 메타에 연속 횟수만 남긴다', async () => {
    setupRows([{ ...baseRow, dhero_status: '배송접수', dhero_status_code: 0, dhero_meta: { bookId: 'BOOK-335' } }])
    mockGetDelivery.mockRejectedValue(new FakeDheroApiError('존재하지 않는 배송건입니다.', 404))
    const body = await runCron()
    expect(body.failed).toBe(1)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('update_reservation_dhero_shipment')
    expect(args).toMatchObject({ p_reservation_id: 335, p_tracking_number: 'BOOK-335', p_courier_code: '두발히어로', p_status: '배송접수', p_status_code: 0, p_return_book_id: null })
    expect(args.p_meta).toMatchObject({ bookId: 'BOOK-335', syncNotFoundCount: 1, syncNotFoundBookId: 'BOOK-335' })
    expect((args.p_meta as Record<string, unknown>).syncNotFoundAt).toBeUndefined()
  })

  it('NF-6: 세 번째 연속 404 면 확정 시각이 기록되고 관리자 확인용 로그가 한 번 남는다', async () => {
    setupRows([{ ...baseRow, dhero_meta: { syncNotFoundCount: NOT_FOUND_CONFIRM_COUNT - 1, syncNotFoundBookId: 'BOOK-335' } }])
    mockGetDelivery.mockRejectedValue(new FakeDheroApiError('존재하지 않는 배송건입니다.', 404))
    await runCron()
    const meta = (mockRpc.mock.calls[0][1] as Record<string, unknown>).p_meta as Record<string, unknown>
    expect(typeof meta.syncNotFoundAt).toBe('string')
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).includes('연속 404'))).toBe(true)
  })

  it('NF-7: 확정된 지 12시간이 안 된 건은 두발히어로를 호출하지 않는다', async () => {
    setupRows([{ ...baseRow, dhero_meta: { syncNotFoundCount: 3, syncNotFoundBookId: 'BOOK-335', syncNotFoundAt: new Date(Date.now() - 3600_000).toISOString() } }])
    const body = await runCron()
    expect(mockGetDelivery).not.toHaveBeenCalled()
    expect(body.total).toBe(0)
  })

  it('NF-8: 12시간이 지난 건은 한 번 다시 조회한다', async () => {
    setupRows([{ ...baseRow, dhero_meta: { syncNotFoundCount: 3, syncNotFoundBookId: 'BOOK-335', syncNotFoundAt: new Date(Date.now() - NOT_FOUND_SKIP_MS - 1000).toISOString() } }])
    mockGetDelivery.mockResolvedValue({ status: 0, bookId: 'BOOK-335' })
    await runCron()
    expect(mockGetDelivery).toHaveBeenCalledTimes(1)
    // 조회에 성공하면 메타가 상태 응답으로 교체되어 표시가 저절로 사라진다
    const meta = (mockRpc.mock.calls[0][1] as Record<string, unknown>).p_meta as Record<string, unknown>
    expect(meta.syncNotFoundCount).toBeUndefined()
    expect(meta.syncNotFoundAt).toBeUndefined()
  })

  it('NF-10: 접수번호가 바뀐 건은 낡은 표시가 남아 있어도 건너뛰지 않고 바로 조회한다', async () => {
    setupRows([{ ...baseRow, tracking_number: 'BOOK-NEW', dhero_meta: { syncNotFoundCount: 3, syncNotFoundBookId: 'BOOK-OLD', syncNotFoundAt: new Date(Date.now() - 3600_000).toISOString() } }])
    mockGetDelivery.mockResolvedValue({ status: 0, bookId: 'BOOK-NEW' })
    await runCron()
    expect(mockGetDelivery).toHaveBeenCalledWith('BOOK-NEW')
  })

  it('NF-11: 반납 leg 가 붙은 건은 발송 leg 가 건너뛰어져도 반납 leg 는 계속 조회한다', async () => {
    setupRows([{
      ...baseRow, dhero_return_book_id: 'R-335', status: 'return_requested',
      dhero_meta: { syncNotFoundCount: 3, syncNotFoundBookId: 'BOOK-335', syncNotFoundAt: new Date(Date.now() - 3600_000).toISOString() },
    }])
    mockGetDelivery.mockResolvedValue({ status: 0, bookId: 'R-335' })
    await runCron()
    const called = mockGetDelivery.mock.calls.map((c) => c[0])
    expect(called).toEqual(['R-335']) // 발송 접수번호(BOOK-335)는 건너뛰고 반납 접수번호만 조회
  })

  it('NF-12: 404 건과 정상 건이 섞여도 정상 건은 그대로 동기화된다', async () => {
    setupRows([{ ...baseRow }, { ...baseRow, id: 400, tracking_number: 'BOOK-400', status: 'shipped' }])
    mockGetDelivery.mockImplementation(async (id: string) => {
      if (id === 'BOOK-335') throw new FakeDheroApiError('존재하지 않는 배송건입니다.', 404)
      return { status: 0, bookId: id }
    })
    const body = await runCron()
    expect(body.synced).toBe(1)
    expect(body.failed).toBe(1)
    const calls = mockRpc.mock.calls as [string, Record<string, unknown>][]
    const ok = calls.find((c) => c[1].p_reservation_id === 400)
    const marked = calls.find((c) => c[1].p_reservation_id === 335)
    expect(ok?.[1].p_status).toBe('배송접수')
    expect((marked?.[1].p_meta as Record<string, unknown>).syncNotFoundCount).toBe(1)
  })

  it('NF-13: 404 표시 저장이 실패해도 크론은 정상 완료되고 다음 주기에 다시 시도한다', async () => {
    setupRows([{ ...baseRow }])
    mockGetDelivery.mockRejectedValue(new FakeDheroApiError('존재하지 않는 배송건입니다.', 404))
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const body = await runCron()
    expect(body.ok).toBe(true)
    expect(body.failed).toBe(1)
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).includes('404 표시 저장 실패'))).toBe(true)
  })

  it('NF-9: 404 가 아닌 오류(500·네트워크)는 표시하지 않고 기존처럼 다음 주기에 다시 조회한다', async () => {
    setupRows([{ ...baseRow }])
    mockGetDelivery.mockRejectedValue(new FakeDheroApiError('서버 오류', 500))
    const body = await runCron()
    expect(body.failed).toBe(1)
    expect(mockRpc).not.toHaveBeenCalled()
    mockGetDelivery.mockRejectedValue(new Error('network down'))
    setupRows([{ ...baseRow }])
    await runCron()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
