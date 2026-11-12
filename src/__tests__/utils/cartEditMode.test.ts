import { describe, it, expect } from 'vitest'
import {
  buildEditOrderLines,
  buildEditOrderBody,
  formatAmountChangedToast,
  isEditLineChanged,
  type EditLineInput,
  type EditLineValues,
} from '$lib/utils/cartEditMode'
import { parseEditOrderBody } from '$lib/server/reservationEditOrder'

const baseValues = (over: Partial<EditLineValues> = {}): EditLineValues => ({
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  pickupMethod: 'visit',
  returnMethod: 'visit',
  pickupTime: '10:00',
  returnTime: '18:00',
  durationType: '24h',
  pickupAddressRoad: '',
  pickupAddressDetail: '',
  pickupPostalCode: '',
  returnAddressRoad: '',
  returnAddressDetail: '',
  returnPostalCode: '',
  pickupRequestNote: '',
  returnRequestNote: '',
  pickupPointId: '',
  returnPointId: '',
  frontdoorPassword: '',
  qty: 1,
  options: [],
  ...over,
})

const line = (over: Partial<EditLineInput> = {}): EditLineInput => ({
  key: 'L1',
  productId: '11111111-1111-4111-8111-111111111111',
  reservationIds: ['101'],
  current: baseValues(),
  original: baseValues(),
  ...over,
})

describe('buildEditOrderLines — Happy', () => {
  it('변경 없는 줄은 keep 줄(예약 id 숫자)로 보낸다', () => {
    const out = buildEditOrderLines([line()], new Set())
    expect(out).toEqual([{ keep: true, reservation_id: 101 }])
  })

  it('같은 상품 2대(그룹) 무변경이면 예약 id 마다 keep 줄', () => {
    const out = buildEditOrderLines([line({ reservationIds: ['101', '102'], current: baseValues({ qty: 2 }), original: baseValues({ qty: 2 }) })], new Set())
    expect(out).toEqual([{ keep: true, reservation_id: 101 }, { keep: true, reservation_id: 102 }])
  })

  it('날짜가 바뀐 줄은 새 줄 필드로 보낸다(keep 아님)', () => {
    const out = buildEditOrderLines([line({ current: baseValues({ endDate: '2026-12-05' }) })], new Set())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      product_id: '11111111-1111-4111-8111-111111111111',
      start_date: '2026-12-01',
      end_date: '2026-12-05',
      pickup_method: 'visit',
      return_method: 'visit',
      pickup_time: '10:00',
      return_time: '18:00',
      duration_type: '24h',
    })
    expect(out[0].keep).toBeUndefined()
  })

  it('수량이 늘면 바뀐 줄로 보고 늘어난 수량만큼 새 줄', () => {
    const out = buildEditOrderLines([line({ reservationIds: ['101', '102'], current: baseValues({ qty: 2 }), original: baseValues({ qty: 1 }) })], new Set())
    expect(out).toHaveLength(2)
    expect(out.every((l) => l.keep === undefined && l.product_id)).toBe(true)
  })

  it('수량이 여러 개인 새 줄은 옵션을 첫 줄에만 싣는다(줄 수만큼 불어나지 않음)', () => {
    const opt = { optionProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'NP-F 배터리', qty: 2 }
    const out = buildEditOrderLines([line({ reservationIds: ['101'], current: baseValues({ qty: 3, options: [opt] }), original: baseValues({ qty: 1 }) })], new Set())
    expect(out).toHaveLength(3)
    expect(out[0].options).toEqual([{ option_product_id: opt.optionProductId, option_name: opt.name, qty: 2 }])
    expect(out[1].options).toBeUndefined()
    expect(out[2].options).toBeUndefined()
  })

  it('원본이 없는 새 줄은 항상 새 줄 필드', () => {
    const out = buildEditOrderLines([line({ reservationIds: [], original: null })], new Set())
    expect(out).toHaveLength(1)
    expect(out[0].keep).toBeUndefined()
  })

  it('새 줄 옵션은 option_product_id·qty 만 담고 수량 0 옵션은 뺀다', () => {
    const out = buildEditOrderLines([
      line({ current: baseValues({ pickupTime: '11:00', options: [
        { optionProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'NP-F 배터리', qty: 2 },
        { optionProductId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '삼각대', qty: 0 },
      ] }) }),
    ], new Set())
    expect(out[0].options).toEqual([{ option_product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', option_name: 'NP-F 배터리', qty: 2 }])
  })

  it('빈 문자열 필드는 새 줄에서 생략한다', () => {
    const out = buildEditOrderLines([line({ current: baseValues({ pickupTime: '11:00' }) })], new Set())
    expect('pickup_address_road' in out[0]).toBe(false)
    expect('frontdoor_password' in out[0]).toBe(false)
  })
})

describe('buildEditOrderLines — Edge', () => {
  it('삭제 보류 줄은 keep·새 줄 모두에서 제외(줄 key 기준)', () => {
    const lines = [line({ key: 'A', reservationIds: ['101'] }), line({ key: 'B', reservationIds: ['102'] })]
    const out = buildEditOrderLines(lines, new Set(['B']))
    expect(out).toEqual([{ keep: true, reservation_id: 101 }])
  })

  it('예약 id 중 하나라도 삭제 보류 집합에 있으면 그 줄을 제외', () => {
    const out = buildEditOrderLines([line({ key: 'A', reservationIds: ['101'] })], new Set(['101']))
    expect(out).toEqual([])
  })

  it('옵션 순서만 다르면 변경 아님', () => {
    const a = [{ optionProductId: 'o1', name: 'a', qty: 1 }, { optionProductId: 'o2', name: 'b', qty: 2 }]
    const b = [a[1], a[0]]
    expect(isEditLineChanged(line({ current: baseValues({ options: b }), original: baseValues({ options: a }) }))).toBe(false)
  })

  it('옵션 수량이 바뀌면 변경', () => {
    const o = (qty: number) => [{ optionProductId: 'o1', name: 'a', qty }]
    expect(isEditLineChanged(line({ current: baseValues({ options: o(2) }), original: baseValues({ options: o(1) }) }))).toBe(true)
  })

  it.each([
    ['startDate', { startDate: '2026-12-02' }],
    ['pickupMethod', { pickupMethod: 'delivery' }],
    ['returnMethod', { returnMethod: 'delivery' }],
    ['pickupTime', { pickupTime: '09:00' }],
    ['returnTime', { returnTime: '19:00' }],
    ['pickupAddressRoad', { pickupAddressRoad: '서울 어딘가' }],
    ['returnAddressDetail', { returnAddressDetail: '101호' }],
    ['pickupPostalCode', { pickupPostalCode: '04524' }],
    ['durationType', { durationType: '12h' }],
    ['pickupPointId', { pickupPointId: 'p1' }],
    ['frontdoorPassword', { frontdoorPassword: '1234' }],
    ['pickupRequestNote', { pickupRequestNote: '문 앞에' }],
  ] as Array<[string, Partial<EditLineValues>]>)('%s 가 바뀌면 변경', (_n, patch) => {
    expect(isEditLineChanged(line({ current: baseValues(patch) }))).toBe(true)
  })

  it('앞뒤 공백·null/빈값 차이는 변경으로 보지 않는다', () => {
    expect(isEditLineChanged(line({ current: baseValues({ pickupAddressRoad: '  ' }), original: baseValues({ pickupAddressRoad: '' }) }))).toBe(false)
  })

  it('원본이 없으면 변경(새 줄)', () => {
    expect(isEditLineChanged(line({ original: null }))).toBe(true)
  })
})

describe('buildEditOrderBody — 서버 parseEditOrderBody 형식과 일치', () => {
  const UC = '22222222-2222-4222-8222-222222222222'
  it('정상 본문은 서버 검증을 통과한다', () => {
    const lines = buildEditOrderLines([line({ current: baseValues({ endDate: '2026-12-09' }) })], new Set())
    const body = buildEditOrderBody({ reservationId: '101', expectedReservationIds: ['102', '101'], lines, selectedCouponIds: [UC], selectedPoints: 500 })
    expect(body).toEqual({ reservationId: 101, expectedReservationIds: [101, 102], lines, selectedCouponIds: [UC], selectedPoints: 500 })
    expect(parseEditOrderBody(body)).not.toBeNull()
  })

  it('쿠폰은 중복 제거·UUID 형식만, 20장 상한', () => {
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const body = buildEditOrderBody({ reservationId: 1, expectedReservationIds: [1], lines: [{ keep: true, reservation_id: 1 }], selectedCouponIds: [UC, UC, 'bad', ...many], selectedPoints: 0 })
    expect(body.selectedCouponIds).toHaveLength(20)
    expect(new Set(body.selectedCouponIds).size).toBe(20)
    expect(body.selectedCouponIds).not.toContain('bad')
    expect(parseEditOrderBody(body)).not.toBeNull()
  })

  it('포인트는 0 이상 정수로 보정(음수·소수·NaN)', () => {
    const mk = (p: number) => buildEditOrderBody({ reservationId: 1, expectedReservationIds: [1], lines: [{ keep: true, reservation_id: 1 }], selectedCouponIds: [], selectedPoints: p })
    expect(mk(-5).selectedPoints).toBe(0)
    expect(mk(10.9).selectedPoints).toBe(10)
    expect(mk(Number.NaN).selectedPoints).toBe(0)
  })

  it('긴 요청사항은 500자로 잘라 서버 상한을 넘지 않는다', () => {
    const lines = buildEditOrderLines([line({ current: baseValues({ pickupRequestNote: 'ㅁ'.repeat(900) }) })], new Set())
    expect((lines[0].pickup_request_note as string).length).toBe(500)
    const body = buildEditOrderBody({ reservationId: 101, expectedReservationIds: [101], lines, selectedCouponIds: [], selectedPoints: 0 })
    expect(parseEditOrderBody(body)).not.toBeNull()
  })
})

describe('formatAmountChangedToast', () => {
  it('천 단위 콤마 포맷', () => {
    expect(formatAmountChangedToast(120000, 95500)).toBe('기존 120,000원 → 새 95,500원')
  })
  it('기존 금액을 모르면 새 금액만', () => {
    expect(formatAmountChangedToast(null, 3000)).toBe('새 3,000원')
  })
  it('새 금액을 모르면 null', () => {
    expect(formatAmountChangedToast(3000, null)).toBeNull()
  })
})
