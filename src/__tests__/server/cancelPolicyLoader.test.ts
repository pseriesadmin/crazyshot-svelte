import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCancelKinds, loadCancelRequestedIds, evaluateReservationCancelKind, loadOrderSiblingKinds, ruleFromMethodRow } from '$lib/server/cancelPolicyLoader'

const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min)

interface Fixture {
  methods: Array<{ method_key: string; is_delivery_type: boolean; deadline_time: string | null }>
  itemsByReservation: Array<{ reservation_id: number; order_id: number }>
  itemsByOrder: Array<{ reservation_id: number; order_id: number }>
  siblings: Array<{ id: number; status: string; tracking_number: string | null; start_date: string | null; pickup_method: string | null }>
  cards?: Array<{ action_payload: { reservation_id?: string } }>
}

/** 필요한 메서드만 흉내내는 최소 Supabase 목 — 필터 값은 무시하고 테이블·조회 컬럼으로 응답을 정한다 */
function fakeClient(f: Fixture): SupabaseClient {
  const make = (table: string) => {
    let inCol = ''
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.eq = (col: string) => { inCol = col; return b }
    b.is = chain
    b.order = chain
    b.in = (col: string) => { inCol = col; return b }
    b.then = (resolve: (v: { data: unknown }) => void) => {
      if (table === 'rental_method_options') return resolve({ data: f.methods })
      if (table === 'order_items') return resolve({ data: inCol === 'order_id' ? f.itemsByOrder : f.itemsByReservation })
      if (table === 'rental_reservations') return resolve({ data: f.siblings })
      if (table === 'chat_messages') return resolve({ data: f.cards ?? [] })
      return resolve({ data: [] })
    }
    return b
  }
  return { from: (t: string) => make(t) } as unknown as SupabaseClient
}

const METHODS = [
  { method_key: 'visit', is_delivery_type: false, deadline_time: '예약 대여일 1일 전 오후 7시까지' },
  { method_key: 'delivery', is_delivery_type: true, deadline_time: '예약 대여일 2일 전 오후 7시까지' },
]

describe('cancelPolicyLoader — 취소 판정 조회', () => {
  it('ruleFromMethodRow: 정형 문구 우선, 없으면 배송형 2일/그 외 1일', () => {
    expect(ruleFromMethodRow({ is_delivery_type: true, deadline_time: '예약 대여일 2일 전 오후 7시까지' })).toEqual({ leadDays: 2, cutoffHour: 19 })
    expect(ruleFromMethodRow({ is_delivery_type: true, deadline_time: null })).toEqual({ leadDays: 2, cutoffHour: 19 })
    expect(ruleFromMethodRow(null)).toEqual({ leadDays: 1, cutoffHour: 19 })
  })

  it('단독 예약: 방식별 마감 규칙 적용 (택배는 2일 전, 방문은 1일 전)', async () => {
    const client = fakeClient({ methods: METHODS, itemsByReservation: [], itemsByOrder: [], siblings: [] })
    const now = kst(2026, 10, 3, 19, 0)
    const kinds = await loadCancelKinds(client, [
      { id: 1, status: 'confirmed', tracking_number: null, start_date: '2026-10-05', pickup_method: 'delivery' },
      { id: 2, status: 'confirmed', tracking_number: null, start_date: '2026-10-05', pickup_method: 'visit' },
    ], now)
    expect(kinds.get('1')).toBe('after_deadline') // 택배: 10/3 19시 마감
    expect(kinds.get('2')).toBe('free')           // 방문: 10/4 19시 마감
  })

  it('형제 예약이 이미 대여 시작(after_start)이면 주문 전체가 취소 불가 — 본인 예약은 아직 먼 미래여도', async () => {
    const client = fakeClient({
      methods: METHODS,
      itemsByReservation: [{ reservation_id: 1, order_id: 10 }],
      itemsByOrder: [{ reservation_id: 1, order_id: 10 }, { reservation_id: 2, order_id: 10 }],
      siblings: [{ id: 2, status: 'confirmed', tracking_number: null, start_date: '2026-09-20', pickup_method: 'visit' }],
    })
    const kinds = await loadCancelKinds(client, [
      { id: 1, status: 'confirmed', tracking_number: null, start_date: '2099-12-31', pickup_method: 'visit' },
    ], kst(2026, 9, 30, 12))
    expect(kinds.get('1')).toBe('after_start')
  })

  it('취소·만료된 형제 예약은 판정에서 제외', async () => {
    const client = fakeClient({
      methods: METHODS,
      itemsByReservation: [{ reservation_id: 1, order_id: 10 }],
      itemsByOrder: [{ reservation_id: 1, order_id: 10 }, { reservation_id: 2, order_id: 10 }],
      siblings: [{ id: 2, status: 'cancelled', tracking_number: null, start_date: '2026-09-20', pickup_method: 'visit' }],
    })
    const kinds = await loadCancelKinds(client, [
      { id: 1, status: 'confirmed', tracking_number: null, start_date: '2099-12-31', pickup_method: 'visit' },
    ], kst(2026, 9, 30, 12))
    expect(kinds.get('1')).toBe('free')
  })

  it('loadOrderSiblingKinds: 형제의 판정 목록(본인 제외) 반환', async () => {
    const client = fakeClient({
      methods: METHODS,
      itemsByReservation: [],
      itemsByOrder: [{ reservation_id: 1, order_id: 10 }, { reservation_id: 2, order_id: 10 }],
      siblings: [{ id: 2, status: 'confirmed', tracking_number: null, start_date: '2026-10-01', pickup_method: 'visit' }],
    })
    const kinds = await loadOrderSiblingKinds(client, 10, 1, kst(2026, 10, 1, 9))
    expect(kinds).toEqual(['after_start'])
  })

  it('조회 결과가 비어 있어도(빈 주문·방식 없음) 안전하게 기본 규칙으로 판정', async () => {
    const client = fakeClient({ methods: [], itemsByReservation: [], itemsByOrder: [], siblings: [] })
    const kinds = await loadCancelKinds(client, [
      { id: 1, status: 'hold', tracking_number: null, start_date: null, pickup_method: null },
    ], Date.now())
    expect(kinds.get('1')).toBe('free')
  })

  it('loadCancelRequestedIds: 취소 요청 카드가 있는 예약 id만 반환', async () => {
    const client = fakeClient({
      methods: [], itemsByReservation: [], itemsByOrder: [], siblings: [],
      cards: [{ action_payload: { reservation_id: '7' } }, { action_payload: { reservation_id: '9' } }, { action_payload: {} }],
    })
    const ids = await loadCancelRequestedIds(client, [7, 8, 9])
    expect([...ids].sort()).toEqual(['7', '9'])
    expect((await loadCancelRequestedIds(client, [])).size).toBe(0)
  })

  it('evaluateReservationCancelKind: 본인이 ②구간이고 형제가 ③이면 ③(가장 엄격)', async () => {
    const client = fakeClient({
      methods: METHODS,
      itemsByReservation: [],
      itemsByOrder: [{ reservation_id: 1, order_id: 10 }, { reservation_id: 2, order_id: 10 }],
      siblings: [{ id: 2, status: 'confirmed', tracking_number: null, start_date: '2026-10-01', pickup_method: 'visit' }],
    })
    const own = { id: 1, status: 'confirmed', tracking_number: null, start_date: '2026-10-05', pickup_method: 'visit' }
    // 10/1 09:00 KST: 본인(10/5 방문)은 아직 마감 전(free), 형제(10/1)는 대여 시작(after_start)
    expect(await evaluateReservationCancelKind(client, own, 10, kst(2026, 10, 1, 9))).toBe('after_start')
    // 형제가 없으면 본인 판정 그대로
    expect(await evaluateReservationCancelKind(client, own, null, kst(2026, 10, 1, 9))).toBe('free')
  })

  it('hold(신청대기)는 형제 예약이 대여 시작(after_start)이어도 free — 취소 API와 동일 (QA M-2)', async () => {
    const client = fakeClient({
      methods: METHODS,
      itemsByReservation: [{ reservation_id: 1, order_id: 10 }],
      itemsByOrder: [{ reservation_id: 1, order_id: 10 }, { reservation_id: 2, order_id: 10 }],
      siblings: [{ id: 2, status: 'confirmed', tracking_number: null, start_date: '2026-09-20', pickup_method: 'visit' }],
    })
    const kinds = await loadCancelKinds(client, [
      { id: 1, status: 'hold', tracking_number: null, start_date: '2099-12-31', pickup_method: 'visit' },
    ], kst(2026, 9, 30, 12))
    expect(kinds.get('1')).toBe('free')
  })
})
