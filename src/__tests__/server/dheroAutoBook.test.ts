import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD — 두발히어로 송장 자동발행 (매일 KST 09:00 크론, 2026-11-18)
 *
 * 규칙(Stephen 승인안):
 *  · 대상 = 계약완료(confirmed) + 송장 없음 + 수령일이 오늘(KST) + 수령 방식의 두발히어로 연동 스위치 켜짐
 *  · 주문(예약코드) 1건 = 접수 1회, 접수번호를 형제 전부에 저장
 *  · 접수 성공 → 반출(shipped) 전환 + 운송장 안내·반출 알림 1회
 *  · 접수 실패 → 건너뜀(상태 불변) + 관리자 푸시, 같은 날 재시도 없음(크론 1일 1회)
 */

const mockCreateDelivery = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  createDelivery: (...a: unknown[]) => mockCreateDelivery(...a),
  DheroApiError: class DheroApiError extends Error { statusCode = 500 },
  DHERO_STATUS_LABEL: { 0: '배송접수' },
}))

const mockIsIntegration = vi.fn()
vi.mock('$lib/server/isDheroIntegrationMethod', () => ({
  isDheroIntegrationMethod: (...a: unknown[]) => mockIsIntegration(...a),
}))

const mockGetRes = vi.fn()
vi.mock('$lib/server/getReservationForDhero', () => ({
  getReservationForDhero: (...a: unknown[]) => mockGetRes(...a),
}))

const mockListOrder = vi.fn()
vi.mock('$lib/server/dheroOrderUnits', () => ({
  listOrderReservationIds: (...a: unknown[]) => mockListOrder(...a),
  joinProductNames: (n: string[]) => n.join(' + '),
}))

vi.mock('$lib/server/dheroMemo', () => ({ pickDeliveryMemo: () => '메모' }))

const mockNotifyTracking = vi.fn()
vi.mock('$lib/server/notifyTrackingRegistered', () => ({
  notifyTrackingRegistered: (...a: unknown[]) => mockNotifyTracking(...a),
}))

const mockLifecyclePush = vi.fn()
const mockManagerPush = vi.fn()
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: (...a: unknown[]) => mockLifecyclePush(...a),
  sendPushToManagers: (...a: unknown[]) => mockManagerPush(...a),
}))

import { runDheroAutoBook } from '$lib/server/dheroAutoBook'

// 2026-11-18 09:00 KST = 2026-11-18T00:00:00Z
const NOW = Date.UTC(2026, 10, 18, 0, 0, 0)

const rpc = vi.fn()
let candidateRows: { id: number; pickup_method: string }[] = []
let cancelRows: { id: number }[] = []
let cancelError: { message: string } | null = null
let cancelInArgs: unknown[] = []
let capturedFilters: Record<string, unknown> = {}
const admin = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: () => {
    const chain: Record<string, unknown> = {}
    let isCancelQuery = false
    chain.select = () => chain
    chain.in = (_k: string, ids: unknown) => { isCancelQuery = true; cancelInArgs = ids as unknown[]; return chain }
    chain.not = () => chain
    chain.neq = () => chain
    chain.eq = (k: string, v: unknown) => { capturedFilters[k] = v; return chain }
    chain.is = (k: string, v: unknown) => { capturedFilters[`is:${k}`] = v; return chain }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: isCancelQuery ? cancelRows : candidateRows, error: isCancelQuery ? cancelError : null })
    return chain
  },
}

function info(id: number, over: Record<string, unknown> = {}) {
  return {
    reservationId: id, status: 'confirmed', pickupMethod: 'crazydelivery', returnMethod: 'crazydelivery',
    trackingNumber: null, courierCode: null, reservationCode: 'R-100', dheroMeta: null,
    customerName: '홍길동', customerPhone: '01012345678', address: '서울 강남구 테헤란로 1', addressDetail: '101호',
    postalCode: '06234', productName: '카메라', frontdoorPassword: null, ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  candidateRows = [{ id: 1, pickup_method: 'crazydelivery' }]
  capturedFilters = {}
  cancelRows = []
  cancelError = null
  cancelInArgs = []
  mockIsIntegration.mockResolvedValue(true)
  mockListOrder.mockImplementation(async (_a: unknown, id: number) => [id])
  mockGetRes.mockImplementation(async (_a: unknown, id: number) => info(id))
  mockCreateDelivery.mockResolvedValue({ bookId: 'BOOK-1', dongGroup: 'A', placePageUrl: null })
  rpc.mockResolvedValue({ data: { ok: true }, error: null })
})

describe('runDheroAutoBook — 대상 판정', () => {
  it('계약완료·송장 없음·수령일=오늘(KST)로만 조회한다', async () => {
    await runDheroAutoBook(admin as never, NOW)
    expect(capturedFilters.status).toBe('confirmed')
    expect(capturedFilters.start_date).toBe('2026-11-18')
    expect(capturedFilters['is:tracking_number']).toBeNull()
  })

  it('KST 날짜 기준 — UTC 전날 23시(=KST 08시)에도 KST 날짜를 쓴다', async () => {
    await runDheroAutoBook(admin as never, Date.UTC(2026, 10, 17, 23, 30, 0))
    expect(capturedFilters.start_date).toBe('2026-11-18')
  })

  it('연동 스위치가 꺼진 방식은 접수하지 않는다', async () => {
    mockIsIntegration.mockResolvedValue(false)
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.booked).toEqual([])
  })

  it('같은 방식은 스위치를 한 번만 조회한다', async () => {
    candidateRows = [{ id: 1, pickup_method: 'x' }, { id: 2, pickup_method: 'x' }]
    await runDheroAutoBook(admin as never, NOW)
    expect(mockIsIntegration).toHaveBeenCalledTimes(1)
  })

  it('이미 살아 있는 접수번호가 있는 주문은 다시 접수하지 않고 관리자에게 알린다', async () => {
    mockGetRes.mockImplementation(async (_a: unknown, id: number) => info(id, { trackingNumber: 'OLD', courierCode: '두발히어로' }))
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.failed).toHaveLength(1)
  })
})

describe('runDheroAutoBook — 주문 단위 접수', () => {
  it('다상품 주문은 접수 1회, 접수번호를 형제 전부에 저장하고 반출 전환도 전부', async () => {
    candidateRows = [{ id: 1, pickup_method: 'm' }, { id: 2, pickup_method: 'm' }]
    mockListOrder.mockResolvedValue([1, 2])
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1)
    const saved = rpc.mock.calls.filter((c) => c[0] === 'update_reservation_dhero_shipment').map((c) => (c[1] as { p_reservation_id: number }).p_reservation_id)
    expect(saved.sort()).toEqual([1, 2])
    const shipped = rpc.mock.calls.filter((c) => c[0] === 'update_reservation_status').map((c) => (c[1] as { p_reservation_id: number; p_new_status: string }))
    expect(shipped.map((s) => s.p_reservation_id).sort()).toEqual([1, 2])
    expect(shipped.every((s) => s.p_new_status === 'shipped')).toBe(true)
    expect(r.booked).toEqual([1])
  })

  it('이미 반출·취소된 형제는 접수·전환에서 뺀다', async () => {
    mockListOrder.mockResolvedValue([1, 2])
    mockGetRes.mockImplementation(async (_a: unknown, id: number) => info(id, id === 2 ? { status: 'cancelled' } : {}))
    await runDheroAutoBook(admin as never, NOW)
    const shipped = rpc.mock.calls.filter((c) => c[0] === 'update_reservation_status').map((c) => (c[1] as { p_reservation_id: number }).p_reservation_id)
    expect(shipped).toEqual([1])
  })

  it('고객이 취소신청한 주문(표식 있음)은 접수·반출·푸시 없이 건너뛴다', async () => {
    cancelRows = [{ id: 1 }]
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(rpc.mock.calls.some((c) => c[0] === 'update_reservation_status')).toBe(false)
    expect(r.failed).toEqual([])
    expect(mockManagerPush).not.toHaveBeenCalled()
  })

  it('취소신청 확인은 주문 전체(형제 포함) id 로 조회한다', async () => {
    mockListOrder.mockResolvedValue([1, 2])
    await runDheroAutoBook(admin as never, NOW)
    expect(cancelInArgs).toEqual([1, 2])
  })

  it('취소신청 확인이 오류면 접수하지 않고 실패로 기록·관리자 푸시(fail-closed)', async () => {
    cancelError = { message: 'db down' }
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.failed).toHaveLength(1)
    expect(mockManagerPush).toHaveBeenCalledTimes(1)
  })

  it('같은 주문 예약을 하나라도 못 읽으면 주문 전체를 건너뛰고 실패로 기록', async () => {
    mockListOrder.mockResolvedValue([1, 2])
    mockGetRes.mockImplementation(async (_a: unknown, id: number) => (id === 2 ? null : info(id)))
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.failed).toHaveLength(1)
  })

  it('접수번호 저장이 실패하면 반출 전환·고객 알림 없이 실패로 기록', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'update_reservation_dhero_shipment' ? { data: null, error: { message: 'save fail' } } : { data: { ok: true }, error: null }))
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(r.failed).toHaveLength(1)
    expect(rpc.mock.calls.some((c) => c[0] === 'update_reservation_status')).toBe(false)
    expect(mockNotifyTracking).not.toHaveBeenCalled()
  })

  it('접수는 예약코드·print 이어받기를 가진 createDelivery 로만 한다', async () => {
    await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).toHaveBeenCalledWith(expect.objectContaining({ orderIdFromCorp: 'R-100', receiverAddressPostalCode: '06234' }))
  })

  it('접수 성공 후 운송장 안내와 반출 알림(채팅·푸시)을 주문당 1회만 보낸다', async () => {
    mockListOrder.mockResolvedValue([1, 2])
    candidateRows = [{ id: 1, pickup_method: 'm' }, { id: 2, pickup_method: 'm' }]
    await runDheroAutoBook(admin as never, NOW)
    expect(mockNotifyTracking).toHaveBeenCalledTimes(1)
    const chat = rpc.mock.calls.filter((c) => c[0] === 'send_rental_chat_notification' && (c[1] as { p_notify_type: string }).p_notify_type === 'shipment_notify')
    expect(chat).toHaveLength(1)
    expect(mockLifecyclePush).toHaveBeenCalledWith(expect.anything(), 1, 'shipment_notify')
  })

  it('자동 처리임을 액션 로그에 남긴다(관리자 없음)', async () => {
    await runDheroAutoBook(admin as never, NOW)
    expect(rpc).toHaveBeenCalledWith('log_rental_action', expect.objectContaining({ p_reservation_id: 1, p_admin_id: null, p_note: 'auto_dhero_book' }))
  })
})

describe('runDheroAutoBook — 실패 처리(fail-soft)', () => {
  it('주소가 없으면 접수 호출 없이 실패로 기록하고 관리자에게 푸시, 상태는 그대로', async () => {
    mockGetRes.mockImplementation(async (_a: unknown, id: number) => info(id, { address: '' }))
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(mockCreateDelivery).not.toHaveBeenCalled()
    expect(r.failed).toHaveLength(1)
    expect(rpc.mock.calls.some((c) => c[0] === 'update_reservation_status')).toBe(false)
    expect(mockManagerPush).toHaveBeenCalledTimes(1)
  })

  it('접수 API 오류면 반출 전환·고객 알림 없이 실패 기록 + 관리자 푸시, 다음 주문은 계속 처리', async () => {
    candidateRows = [{ id: 1, pickup_method: 'm' }, { id: 5, pickup_method: 'm' }]
    mockCreateDelivery.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ bookId: 'BOOK-5', dongGroup: null, placePageUrl: null })
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(r.failed.map((f) => f.reservationId)).toEqual([1])
    expect(r.booked).toEqual([5])
    expect(mockNotifyTracking).toHaveBeenCalledTimes(1)
    expect(mockManagerPush).toHaveBeenCalledTimes(1)
  })

  it('접수는 됐는데 반출 전환이 실패하면 실패로 기록한다(접수번호는 저장돼 있어 재시도로 중복 접수되지 않는다)', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'update_reservation_status' ? { data: { ok: false, error: '전환 불가' }, error: null } : { data: { ok: true }, error: null }))
    const r = await runDheroAutoBook(admin as never, NOW)
    expect(r.failed).toHaveLength(1)
    expect(r.booked).toEqual([])
  })

  it('접수는 됐으나 전환 실패 건이 있으면 푸시 문구에 마무리 안내를 붙인다', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'update_reservation_status' ? { data: { ok: false, error: 'x' }, error: null } : { data: { ok: true }, error: null }))
    await runDheroAutoBook(admin as never, NOW)
    expect(mockManagerPush.mock.calls[0][1]).toMatchObject({ body: expect.stringContaining('[출고 처리]로 마무리') })
  })

  it('실패가 없으면 관리자 푸시를 보내지 않는다', async () => {
    await runDheroAutoBook(admin as never, NOW)
    expect(mockManagerPush).not.toHaveBeenCalled()
  })

  it('조회 오류는 throw 하지 않고 빈 결과', async () => {
    const bad = { rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) }
    const r = await runDheroAutoBook(bad as never, NOW)
    expect(r.booked).toEqual([])
    expect(r.error).toBe('x')
  })
})
