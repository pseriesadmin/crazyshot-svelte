import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseEditParam, loadCartEditContext, excludeSubmittedReservations, editRedirectLocation } from '$lib/server/cartEditLoader'

const USER = 'u-me'

interface Fx {
  state?: unknown
  stateError?: boolean
  itemsByReservation?: Array<{ order_id: number }>
  itemsByOrder?: Array<{ reservation_id: number; order_id: number }>
  reservations?: Array<{ id: number; user_id: string; status: string }>
  order?: { user_id: string; selected_points: number | null } | null
  coupons?: Array<{ user_coupon_id: string }>
}

function fake(f: Fx): { client: SupabaseClient; calls: string[] } {
  const calls: string[] = []
  const make = (table: string) => {
    let col = ''
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (c: string) => { col = c; return b }
    b.in = (c: string) => { col = c; return b }
    b.limit = () => b
    b.maybeSingle = () => Promise.resolve({ data: f.order ?? null, error: null })
    b.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (table === 'order_items') return resolve({ data: col === 'order_id' ? (f.itemsByOrder ?? []) : (f.itemsByReservation ?? []), error: null })
      if (table === 'rental_reservations') return resolve({ data: f.reservations ?? [], error: null })
      if (table === 'order_coupons') return resolve({ data: f.coupons ?? [], error: null })
      return resolve({ data: [], error: null })
    }
    return b
  }
  const client = {
    from: (t: string) => { calls.push(t); return make(t) },
    rpc: (name: string, args: unknown) => {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`)
      return Promise.resolve(f.stateError ? { data: null, error: { message: 'x' } } : { data: f.state, error: null })
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

const okFx = (): Fx => ({
  state: { ok: true, can_edit: true, reason: 'ok' },
  itemsByReservation: [{ order_id: 7 }],
  itemsByOrder: [{ reservation_id: 101, order_id: 7 }, { reservation_id: 102, order_id: 7 }, { reservation_id: 103, order_id: 7 }],
  reservations: [
    { id: 101, user_id: USER, status: 'hold' },
    { id: 102, user_id: USER, status: 'hold' },
    { id: 103, user_id: USER, status: 'cancelled' },
  ],
  order: { user_id: USER, selected_points: 1500 },
  coupons: [{ user_coupon_id: 'c1' }, { user_coupon_id: 'c2' }],
})

describe('parseEditParam', () => {
  it('없으면 null(수정 모드 아님)', () => {
    expect(parseEditParam(null)).toEqual({ present: false })
  })
  it('양의 정수 문자열', () => {
    expect(parseEditParam('101')).toEqual({ present: true, id: 101 })
  })
  it.each(['abc', '0', '-3', '1.5', '', ' ', '1e3', '99999999999'])('잘못된 값 %j 는 present 이지만 id 없음', (v) => {
    expect(parseEditParam(v)).toEqual({ present: true, id: null })
  })
})

describe('loadCartEditContext', () => {
  it('Happy — DB 판정 통과 시 주문 소속 살아있는 예약·포인트·쿠폰을 돌려준다', async () => {
    const { client, calls } = fake(okFx())
    const r = await loadCartEditContext(client, USER, 101)
    const blank = { pickupAddressRoad: null, pickupAddressDetail: null, pickupPostalCode: null, returnAddressRoad: null, returnAddressDetail: null, returnPostalCode: null, pickupRequestNote: null, returnRequestNote: null, pickupPointId: null, returnPointId: null }
    expect(r).toEqual({
      ok: true,
      reservationDetails: { '101': blank, '102': blank },
      editReservationId: 101,
      editOrderId: 7,
      editOrderReservationIds: ['101', '102'],
      initialPoints: 1500,
      initialCouponIds: ['c1', 'c2'],
    })
    expect(calls.some((c) => c.startsWith('rpc:get_reservation_edit_state:'))).toBe(true)
    expect(calls.find((c) => c.startsWith('rpc:'))).toContain('"p_reservation_id":101')
  })

  it('can_edit false 면 사유 코드와 함께 실패', async () => {
    const fx = okFx(); fx.state = { ok: true, can_edit: false, reason: 'SIGNED' }
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'SIGNED' })
  })

  it('판정 호출 오류는 ERROR(fail-closed)', async () => {
    const fx = okFx(); fx.stateError = true
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'ERROR' })
  })

  it('취소되지 않은 예약의 저장된 주소·요청사항·지점을 내려주고 공동현관 번호는 싣지 않는다', async () => {
    const fx = okFx()
    fx.reservations = [
      { id: 101, user_id: USER, status: 'hold', pickup_address_road: '서울 어딘가 1', pickup_address_detail: '101호', pickup_postal_code: '04100', pickup_request_note: '문앞', pickup_point_id: 'pp1', frontdoor_password: '1234' } as unknown as { id: number; user_id: string; status: string },
      { id: 102, user_id: USER, status: 'hold' },
      { id: 103, user_id: USER, status: 'cancelled', pickup_address_road: '취소건' } as unknown as { id: number; user_id: string; status: string },
    ]
    const r = await loadCartEditContext(fake(fx).client, USER, 101)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.reservationDetails)).toEqual(['101', '102'])
    expect(r.reservationDetails['101']).toMatchObject({ pickupAddressRoad: '서울 어딘가 1', pickupAddressDetail: '101호', pickupPostalCode: '04100', pickupRequestNote: '문앞', pickupPointId: 'pp1', returnAddressRoad: null })
    expect(JSON.stringify(r.reservationDetails)).not.toContain('1234')
  })

  it('판정 응답이 이상하면 ERROR', async () => {
    const fx = okFx(); fx.state = 'weird'
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'ERROR' })
  })

  it('알 수 없는 사유 문자열은 ERROR 로 정리(임의 문자열을 주소에 싣지 않음)', async () => {
    const fx = okFx(); fx.state = { ok: false, can_edit: false, reason: '<script>' }
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'ERROR' })
  })

  it('Error — DB 가 통과시켜도 대상 예약 소유자가 다르면 NOT_OWNER(이중 확인)', async () => {
    const fx = okFx(); fx.reservations = [{ id: 101, user_id: 'other', status: 'hold' }, { id: 102, user_id: USER, status: 'hold' }]
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'NOT_OWNER' })
  })

  it('형제 중 남의 예약이 섞여 있어도 NOT_OWNER', async () => {
    const fx = okFx(); fx.reservations = [{ id: 101, user_id: USER, status: 'hold' }, { id: 102, user_id: 'other', status: 'hold' }]
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'NOT_OWNER' })
  })

  it('주문 소유자가 다르면 NOT_OWNER', async () => {
    const fx = okFx(); fx.order = { user_id: 'other', selected_points: 0 }
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'NOT_OWNER' })
  })

  it('주문 항목이 없으면(제출 전 예약) NOT_SUBMITTED', async () => {
    const fx = okFx(); fx.itemsByReservation = []
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'NOT_SUBMITTED' })
  })

  it('대상 예약이 살아있는 형제 목록에 없으면 STALE', async () => {
    const fx = okFx(); fx.reservations = [{ id: 101, user_id: USER, status: 'cancelled' }, { id: 102, user_id: USER, status: 'hold' }]
    expect(await loadCartEditContext(fake(fx).client, USER, 101)).toEqual({ ok: false, reason: 'STALE' })
  })

  it('포인트 null 이면 0, 쿠폰 없으면 빈 배열', async () => {
    const fx = okFx(); fx.order = { user_id: USER, selected_points: null }; fx.coupons = []
    const r = await loadCartEditContext(fake(fx).client, USER, 101)
    expect(r).toMatchObject({ ok: true, initialPoints: 0, initialCouponIds: [] })
  })
})

describe('excludeSubmittedReservations — 기존 필터(회귀)', () => {
  const rows = [{ id: 1 }, { id: '2' }, { id: 3 }]
  it('면제 없음: 기존 동작 그대로(주문에 묶인 예약 제외)', () => {
    expect(excludeSubmittedReservations(rows, new Set(['2']), new Set())).toEqual([{ id: 1 }, { id: 3 }])
  })
  it('면제 없음 인자를 생략해도 동일', () => {
    expect(excludeSubmittedReservations(rows, new Set(['1', '3']))).toEqual([{ id: '2' }])
  })
  it('수정 대상 주문의 예약만 면제', () => {
    expect(excludeSubmittedReservations(rows, new Set(['1', '2', '3']), new Set(['1', '2']))).toEqual([{ id: 1 }, { id: '2' }])
  })
})

describe('editRedirectLocation', () => {
  it('사유 코드를 editError 로 싣는다', () => {
    expect(editRedirectLocation('SIGNED')).toBe('/account/rental?editError=SIGNED')
  })
})
