/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * TDD — 반납 접수(대여중→반납중) 경로의 두발히어로 반품 접수 연동 (2026-10-23)
 *
 * 배경: 두발히어로 반품 접수(registerReturn)는 updateStatus 액션이 return_requested 로 전환할 때만 호출됐는데,
 * 고객 반납정보 제출(return-submit)·관리자 대리 등록(return-entries)이 update_reservation_status RPC 를 직접 호출해 이를 우회했다.
 * 공용 헬퍼 registerDheroReturn 이 updateStatus 분기와 같은 규칙으로 처리한다.
 *
 * 규칙: 반납방식이 is_dhero_integration 이고 운송장이 있을 때만 호출 / 이미 반품 접수(dhero_return_book_id)가 있으면 중복 접수 안 함 /
 *       실패해도 throw 하지 않고 결과(failed)로 반환(제출·등록은 성공 처리).
 *
 * 2026-10-27 추가: 형제 단위 중복 방어 — 같은 주문·같은 접수번호의 형제가 이미 반품 접수됐으면 API 재호출 없이 형제 반품번호를 저장한다.
 */

const mockGetReservation = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...args: unknown[]) => mockGetReservation(...args),
}))

const mockIsBulk = vi.fn()
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({
  isDheroIntegrationMethod: (...args: unknown[]) => mockIsBulk(...args),
}))

const mockRegisterReturn = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  registerReturn: (...args: unknown[]) => mockRegisterReturn(...args),
  DHERO_STATUS_LABEL: { 0: '배송접수' },
  DheroApiError: class DheroApiError extends Error {
    statusCode: number
    constructor(message: string, statusCode = 0) {
      super(message)
      this.statusCode = statusCode
    }
  },
}))

// 형제 단위 조회 헬퍼 mock (dheroOrderUnits)
const mockListSameBookIds = vi.fn()
vi.mock('$lib/server/dheroOrderUnits', () => ({
  listSameBookReservationIds: (...args: unknown[]) => mockListSameBookIds(...args),
}))

const { registerDheroReturn, DHERO_RETURN_TIMEOUT_MS } = await import('../../lib/server/registerDheroReturn')
const { DheroApiError } = await import('../../lib/server/dhero')

function resInfo(over: Record<string, unknown> = {}) {
  return { reservationId: 7, returnMethod: 'delivery', trackingNumber: 'BK123', dheroReturnBookId: null, ...over }
}

/**
 * makeAdmin — admin 클라이언트 mock 빌더
 *
 * @param rpcResult        rpc() 반환값 (기본: { error: null })
 * @param siblingRow       rental_reservations 형제 쿼리 결과(dhero_return_book_id 조회).
 *                         null 이면 형제 반품 접수 없음 → 단독 접수 흐름. 기본값 null.
 * @param siblingQueryError maybeSingle() 에서 반환할 Supabase 오류. 설정 시 data=null, error=this.
 */
function makeAdmin(
  rpcResult: { error: { message: string } | null } = { error: null },
  siblingRow: { dhero_return_book_id: string } | null = null,
  siblingQueryError: { message: string } | null = null,
) {
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.not = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(
    siblingQueryError
      ? { data: null, error: siblingQueryError }
      : { data: siblingRow, error: null },
  )
  const from = vi.fn().mockReturnValue(chain)
  return { admin: { rpc, from }, rpc }
}

beforeEach(() => {
  mockGetReservation.mockReset()
  mockIsBulk.mockReset()
  mockRegisterReturn.mockReset()
  mockListSameBookIds.mockReset()
  // 기본값: 형제 없음(자신만 반환) — 기존 테스트는 sibling 경로를 거치지 않는다
  mockListSameBookIds.mockResolvedValue([7])
})

describe('registerDheroReturn', () => {
  it('배송대여 + 운송장 + 미접수 → 반품 접수 호출 후 저장(update_reservation_dhero_shipment)', async () => {
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockRegisterReturn.mockResolvedValue({ bookId: 'BK123R', dongGroup: 'G1' })
    const { admin, rpc } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('registered')
    expect(mockRegisterReturn).toHaveBeenCalledWith('BK123')
    expect(rpc).toHaveBeenCalledWith('update_reservation_dhero_shipment', expect.objectContaining({
      p_reservation_id: 7,
      p_tracking_number: 'BK123',
      p_return_book_id: 'BK123R',
      p_dong_group: 'G1',
    }))
  })

  it('배송대여가 아닌 반납방식 → 건너뜀(두발히어로 호출 없음)', async () => {
    mockGetReservation.mockResolvedValue(resInfo({ returnMethod: 'visit' }))
    mockIsBulk.mockResolvedValue(false)
    const { admin } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('skipped')
    expect(mockRegisterReturn).not.toHaveBeenCalled()
  })

  it('운송장이 없으면 건너뜀(반출을 두발히어로로 하지 않은 예약)', async () => {
    mockGetReservation.mockResolvedValue(resInfo({ trackingNumber: null }))
    mockIsBulk.mockResolvedValue(true)
    const { admin } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('skipped')
    expect(mockRegisterReturn).not.toHaveBeenCalled()
  })

  it('이미 반품 접수가 있으면 중복 접수하지 않는다(재제출·재시도 방어)', async () => {
    mockGetReservation.mockResolvedValue(resInfo({ dheroReturnBookId: 'BK123R' }))
    mockIsBulk.mockResolvedValue(true)
    const { admin } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('skipped')
    expect(mockRegisterReturn).not.toHaveBeenCalled()
  })

  it('예약을 못 찾으면 건너뜀', async () => {
    mockGetReservation.mockResolvedValue(null)
    const { admin } = makeAdmin()

    expect((await registerDheroReturn(admin, 7)).outcome).toBe('skipped')
    expect(mockRegisterReturn).not.toHaveBeenCalled()
  })

  it('두발히어로 API 실패 → throw 없이 failed(메시지 포함), 저장 호출 없음', async () => {
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockRegisterReturn.mockRejectedValue(new DheroApiError('반품 불가 상태', 412))
    const { admin, rpc } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('failed')
    expect(r.message).toContain('반품 불가 상태')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('응답이 success=false 면(안내서 반품 응답 규격) 저장하지 않고 failed — reason 포함', async () => {
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockRegisterReturn.mockResolvedValue({ bookId: 'R-BK123', success: false, reason: '수거 불가 지역' })
    const { admin, rpc } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('failed')
    expect(r.message).toContain('수거 불가 지역')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('접수는 성공했지만 DB 저장이 실패하면 failed(수동 확인 필요 메시지)', async () => {
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockRegisterReturn.mockResolvedValue({ bookId: 'BK123R', dongGroup: null })
    const { admin } = makeAdmin({ error: { message: 'db down' } })

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('failed')
    expect(r.message).toContain('BK123R')
  })

  it('두발히어로 응답이 지연되면 상한(8초) 뒤 failed 로 끝낸다(제출 요청이 길게 매달리지 않음)', async () => {
    vi.useFakeTimers()
    try {
      mockGetReservation.mockResolvedValue(resInfo())
      mockIsBulk.mockResolvedValue(true)
      mockRegisterReturn.mockReturnValue(new Promise(() => {})) // 응답이 오지 않음
      const { admin, rpc } = makeAdmin()

      const pending = registerDheroReturn(admin, 7)
      await vi.advanceTimersByTimeAsync(DHERO_RETURN_TIMEOUT_MS + 10)
      const r = await pending

      expect(r.outcome).toBe('failed')
      expect(r.message).toContain('지연')
      expect(rpc).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('예약 조회 중 예외가 나도 throw 하지 않는다', async () => {
    mockGetReservation.mockRejectedValue(new Error('boom'))
    const { admin } = makeAdmin()

    const r = await registerDheroReturn(admin, 7)

    expect(r.outcome).toBe('failed')
  })

  // ── 형제 단위 중복 방어 (2026-10-27) ─────────────────────────────────────
  // 같은 주문·같은 접수번호의 형제 예약이 이미 반품 접수됐으면 두발히어로 API 를
  // 다시 호출하지 않고 형제 반품번호를 자신에게도 저장해야 한다.

  it('같은 접수번호 형제가 이미 반품 접수됐으면 — API 재호출 없이 형제 반품번호를 저장한다', async () => {
    // 이 예약(id=7)과 형제(id=8)가 같은 접수번호(BK123)를 공유.
    // 형제(8)는 이미 dhero_return_book_id = 'BK123-R'을 가진다.
    mockGetReservation.mockResolvedValue(resInfo()) // 자신은 미접수
    mockIsBulk.mockResolvedValue(true)
    // 형제 조회: [7, 8] 반환 → 7 이외에 8이 있음
    mockListSameBookIds.mockResolvedValue([7, 8])
    // makeAdmin: siblingRow 에 형제 반품번호
    const { admin, rpc } = makeAdmin({ error: null }, { dhero_return_book_id: 'BK123-R' })

    const r = await registerDheroReturn(admin, 7)

    // 두발히어로 API 미호출 — 형제 번호 재사용
    expect(mockRegisterReturn).not.toHaveBeenCalled()
    // 형제 반품번호를 자신에게 저장
    expect(rpc).toHaveBeenCalledWith('update_reservation_dhero_shipment', expect.objectContaining({
      p_reservation_id: 7,
      p_return_book_id: 'BK123-R',
    }))
    expect(r.outcome).toBe('registered')
  })

  it('형제 반품번호 저장 시 현재 dhero 상태값(상태 코드·동 그룹·메타)을 덮어쓰지 않는다', async () => {
    // 이미 크론이 한 번 실행돼 dheroStatus·dheroStatusCode·dheroDongGroup·dheroMeta 가 저장된 상태.
    // 형제 반품번호를 저장할 때 이 값들을 그대로 넘겨야 한다(null·{}로 덮어쓰기 금지).
    const currentDhero = {
      dheroStatus: '배송완료',
      dheroStatusCode: 5,
      dheroDongGroup: 'DONG-G1',
      dheroMeta: { bookId: 'BK123', status: 5, someKey: 'val' },
    }
    mockGetReservation.mockResolvedValue(resInfo(currentDhero))
    mockIsBulk.mockResolvedValue(true)
    mockListSameBookIds.mockResolvedValue([7, 8])
    const { admin, rpc } = makeAdmin({ error: null }, { dhero_return_book_id: 'BK123-R' })

    await registerDheroReturn(admin, 7)

    const rpcCall = rpc.mock.calls.find(
      (c: unknown[]) => c[0] === 'update_reservation_dhero_shipment'
    )
    const args = rpcCall?.[1] as Record<string, unknown>
    // 기존 상태 값이 그대로 전달돼야 한다
    expect(args?.p_status).toBe('배송완료')
    expect(args?.p_status_code).toBe(5)
    expect(args?.p_dong_group).toBe('DONG-G1')
    expect(args?.p_meta).toEqual({ bookId: 'BK123', status: 5, someKey: 'val' })
  })

  it('형제 maybeSingle 조회에서 DB 오류가 반환되면 API를 정상 호출한다(fail-soft)', async () => {
    // DB 에서 { data: null, error: {...} } 가 오면 형제 없음으로 처리해야 한다.
    // 주석: dheroOrderUnits.ts 의 listSameBookReservationIds 가 tracking_number 동일 필터를
    //        수행하며, dheroOrderLevelManual.test.ts 에서 'BOOK-1' vs 'OTHER' 로 검증됨.
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockListSameBookIds.mockResolvedValue([7, 8])
    // maybeSingle DB 오류 — siblingQueryError 인자로 전달
    const { admin, rpc } = makeAdmin({ error: null }, null, { message: 'db error during sibling lookup' })
    mockRegisterReturn.mockResolvedValue({ bookId: 'BK123-NEW-R', dongGroup: null })

    const r = await registerDheroReturn(admin, 7)

    // DB 오류는 null 로 처리 → 두발히어로 API 정상 호출
    expect(mockRegisterReturn).toHaveBeenCalledWith('BK123')
    expect(rpc).toHaveBeenCalledWith('update_reservation_dhero_shipment', expect.objectContaining({
      p_return_book_id: 'BK123-NEW-R',
    }))
    expect(r.outcome).toBe('registered')
  })

  it('형제가 있어도 반품 접수가 없으면 두발히어로 API를 정상 호출한다', async () => {
    // 형제(8)가 있지만 아직 dhero_return_book_id 가 없음
    mockGetReservation.mockResolvedValue(resInfo())
    mockIsBulk.mockResolvedValue(true)
    mockListSameBookIds.mockResolvedValue([7, 8])
    // siblingRow = null → 형제 반품 접수 없음
    const { admin, rpc } = makeAdmin({ error: null }, null)
    mockRegisterReturn.mockResolvedValue({ bookId: 'BK123-NEW-R', dongGroup: null })

    const r = await registerDheroReturn(admin, 7)

    // 두발히어로 API 정상 호출
    expect(mockRegisterReturn).toHaveBeenCalledWith('BK123')
    expect(rpc).toHaveBeenCalledWith('update_reservation_dhero_shipment', expect.objectContaining({
      p_return_book_id: 'BK123-NEW-R',
    }))
    expect(r.outcome).toBe('registered')
  })
})

describe('연결 가드 — 전환 직후 두 경로가 헬퍼를 호출한다', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8')

  it.each([
    ['고객 반납 제출', 'routes/api/account/rental/[id]/return-submit/+server.ts'],
    ['관리자 대리 등록', 'routes/api/cms/reservations/[id]/return-entries/+server.ts'],
  ])('%s — return_requested 전환 성공 뒤에 registerDheroReturn 호출', (_name, file) => {
    const src = read(file)
    const transition = src.indexOf("p_new_status: 'return_requested'")
    const call = src.indexOf('registerDheroReturn(')
    expect(transition).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(transition)
    expect(src).toContain("from '$lib/server/registerDheroReturn'")
  })
})
