import { describe, it, expect } from 'vitest'
import { orderHasReturnFeedback, validateOrderReturnSubmit, type OrderReturnUnit } from '$lib/server/returnSubmitOrderUnits'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const photos = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
const checklist = [{ key: 'body' }, { key: 'clean' }]

function courierUnit(id: number): OrderReturnUnit {
  return { id, method: 'courier', status: 'in_use' }
}
function courierBody(id: number) {
  return {
    reservation_id: id,
    checklist: ['body', 'clean'],
    media: photos.map((p) => ({ item_key: p.key, path: `${id}/${p.key}/${UUID}.jpg`, kind: 'photo' })),
  }
}

describe('validateOrderReturnSubmit — 상품별 반납 기록 필수', () => {
  it('상품 2개 모두 사진·체크가 있으면 통과, 평가는 첫 상품에만 붙는다', () => {
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1), courierBody(2)], feedback: '좋아요', rating: 5 }, checklist, photos)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((u) => u.id)).toEqual([1, 2])
    expect(r.value[0].input.feedback).toBe('좋아요')
    expect(r.value[0].input.rating).toBe(5)
    expect(r.value[1].input.feedback).toBeNull()
    expect(r.value[1].input.rating).toBeNull()
  })

  it('한 상품이 빠지면 거절', () => {
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1)] }, checklist, photos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('모든 상품')
  })

  it('한 상품의 사진이 부족하면 그 상품 때문에 거절', () => {
    const b2 = { ...courierBody(2), media: courierBody(2).media.slice(0, 2) }
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1), b2] }, checklist, photos)
    expect(r.ok).toBe(false)
  })

  it('한 상품의 체크가 부족하면 거절', () => {
    const b2 = { ...courierBody(2), checklist: ['body'] }
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1), b2] }, checklist, photos)
    expect(r.ok).toBe(false)
  })

  it('다른 상품 사진 경로를 섞으면 거절', () => {
    const b2 = { ...courierBody(2), media: courierBody(1).media }
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1), b2] }, checklist, photos)
    expect(r.ok).toBe(false)
  })

  it('주문에 없는 상품 id가 섞이면 거절', () => {
    const r = validateOrderReturnSubmit([courierUnit(1)], { units: [courierBody(1), courierBody(9)] }, checklist, photos)
    expect(r.ok).toBe(false)
  })

  it('같은 상품이 두 번 오면 거절', () => {
    const r = validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], { units: [courierBody(1), courierBody(1)] }, checklist, photos)
    expect(r.ok).toBe(false)
  })

  it('방식이 다른 상품은 각자 요건으로 검증(퀵은 사진 불필요)', () => {
    const units: OrderReturnUnit[] = [courierUnit(1), { id: 2, method: 'quick', status: 'in_use' }]
    const r = validateOrderReturnSubmit(units, { units: [courierBody(1), { reservation_id: 2 }] }, checklist, photos)
    expect(r.ok).toBe(true)
  })

  it('단일 상품 옛 형식 본문(units 없음)도 받는다', () => {
    const { reservation_id: _ignored, ...legacy } = courierBody(1)
    void _ignored
    const r = validateOrderReturnSubmit([courierUnit(1)], { ...legacy, feedback: 'ok' }, checklist, photos)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0].input.feedback).toBe('ok')
  })

  it('상품이 여러 개인데 옛 형식 본문이면 거절', () => {
    const { reservation_id: _ignored, ...legacy } = courierBody(1)
    void _ignored
    expect(validateOrderReturnSubmit([courierUnit(1), courierUnit(2)], legacy, checklist, photos).ok).toBe(false)
  })

  it('등록할 상품이 없으면 거절', () => {
    expect(validateOrderReturnSubmit([], { units: [] }, checklist, photos).ok).toBe(false)
  })
})

describe('orderHasReturnFeedback — 재제출 때 평가 재부착 방지', () => {
  function fakeAdmin(orderIds: number[], subs: { customer_feedback: string | null; customer_rating: number | null }[]) {
    return {
      from(table: string) {
        const q = {
          select: () => q,
          eq: () => q,
          in: () => q,
          maybeSingle: async () => ({ data: { order_id: 1 } }),
          then: (res: (v: unknown) => unknown) => res({ data: table === 'order_items' ? orderIds.map((r) => ({ reservation_id: r })) : subs }),
        }
        return q
      },
    }
  }
  it('같은 주문에 평가가 이미 있으면 true', async () => {
    expect(await orderHasReturnFeedback(fakeAdmin([1, 2], [{ customer_feedback: null, customer_rating: 5 }]), 2)).toBe(true)
  })
  it('평가가 없으면 false', async () => {
    expect(await orderHasReturnFeedback(fakeAdmin([1, 2], [{ customer_feedback: null, customer_rating: null }]), 2)).toBe(false)
  })
  it('조회가 터지면 false(평가는 선택 항목)', async () => {
    const boom = { from() { throw new Error('x') } }
    expect(await orderHasReturnFeedback(boom, 2)).toBe(false)
  })
})
