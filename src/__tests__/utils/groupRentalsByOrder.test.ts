import { describe, it, expect } from 'vitest'
import { groupRentalsByOrder, type GroupableRental } from '$lib/utils/groupRentalsByOrder'

function r(id: string, over: Partial<GroupableRental> = {}): GroupableRental {
  return {
    id, status: 'hold', start_date: '2026-10-30', end_date: '2026-10-31',
    product_name: `상품${id}`, product_category: 'cat',
    has_signed_contract: false, pending_contract_token: null,
    returnSubmittable: false, returnSubmitted: false, cancelling: false, ...over,
  }
}

describe('groupRentalsByOrder — 같은 주문은 카드 1장', () => {
  it('같은 주문의 예약 2건 → 카드 1장, 상품 2개', () => {
    const rows = [r('53822'), r('54542')]
    const out = groupRentalsByOrder(rows, new Map([['53822', 10323], ['54542', 10323]]))
    expect(out).toHaveLength(1)
    expect(out[0].items.map(i => i.name)).toEqual(['상품53822', '상품54542'])
  })

  it('주문이 없는 예약은 각자 카드', () => {
    const out = groupRentalsByOrder([r('1'), r('2')], new Map())
    expect(out).toHaveLength(2)
    expect(out[0].items).toHaveLength(1)
  })

  it('서로 다른 주문은 묶이지 않고 목록 순서를 유지', () => {
    const out = groupRentalsByOrder([r('5'), r('3'), r('4')], new Map([['5', 1], ['3', 2], ['4', 1]]))
    expect(out.map(o => o.items.map(i => i.id))).toEqual([['4', '5'], ['3']])
  })

  it('주문 상태 = 가장 덜 진행된 상품 상태', () => {
    const out = groupRentalsByOrder([r('1', { status: 'in_use' }), r('2', { status: 'confirmed' })], new Map([['1', 9], ['2', 9]]))
    expect(out[0].status).toBe('confirmed')
  })

  it('대여기간은 상품들의 가장 이른 시작 ~ 가장 늦은 종료', () => {
    const out = groupRentalsByOrder(
      [r('1', { start_date: '2026-10-30', end_date: '2026-10-31' }), r('2', { start_date: '2026-10-29', end_date: '2026-11-02' })],
      new Map([['1', 9], ['2', 9]]),
    )
    expect([out[0].start_date, out[0].end_date]).toEqual(['2026-10-29', '2026-11-02'])
  })

  it('계약서는 한 상품에만 걸려 있어도 카드에 반영, 취소중·취소요청은 주문 전체에 적용', () => {
    const out = groupRentalsByOrder(
      [r('1'), r('2', { has_signed_contract: true, cancelling: true, cancelRequested: true })],
      new Map([['1', 9], ['2', 9]]),
    )
    expect(out[0].has_signed_contract).toBe(true)
    expect(out[0].cancelling).toBe(true)
    expect((out[0] as { cancelRequested?: boolean }).cancelRequested).toBe(true)
  })

  it('반납정보 등록 대상은 아직 제출하지 않은 첫 상품', () => {
    const out = groupRentalsByOrder(
      [r('1', { returnSubmittable: true, returnSubmitted: true }), r('2', { returnSubmittable: true })],
      new Map([['1', 9], ['2', 9]]),
    )
    expect(out[0].returnTargetId).toBe('2')
    expect(out[0].returnSubmitted).toBe(false)
  })
})
