/**
 * TDD-RED: cartLineGrouping.test.ts
 * 장바구니 동일 부모상품 중복담기 → 하나로 병합 그룹핑 로직 검증
 * (plan: 장바구니 동일 부모상품 중복담기 → 하나로 병합, 2026-08-28 Stephen GATE B 승인)
 *
 * 테스트 전략:
 *   - 순수 함수 단위 테스트 (DB 연동 없음)
 *   - 병합 조건: hold는 부모상품+수령일+반납일 완전 일치, draft는 부모상품만
 *   - 옵션은 그룹 내 전체 멤버를 대상으로 합산
 *   - product가 null(자식 삭제 등 저하 케이스)이면 항상 단독 그룹
 */

import { describe, it, expect } from 'vitest'
import { groupCartLineItems, type GroupableLineItem } from '$lib/utils/cartLineGrouping'

const PARENT_A = { id: 'child-a1', parent_product_id: 'parent-a' }
const PARENT_A_CHILD2 = { id: 'child-a2', parent_product_id: 'parent-a' }
const PARENT_B = { id: 'child-b1', parent_product_id: 'parent-b' }
const DRAFT_PARENT_A = { id: 'parent-a', parent_product_id: null }

function makeItem(overrides: Partial<GroupableLineItem>): GroupableLineItem {
  return {
    reservationId: '1',
    productId: PARENT_A.id,
    product: PARENT_A,
    price12h: 10000,
    price24h: 20000,
    deposit: 50000,
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    pickupMethod: 'visit',
    returnMethod: 'visit',
    pickupTime: '10:00',
    returnTime: '10:00',
    durationType: '24h',
    options: [],
    status: 'hold',
    ...overrides,
  }
}

describe('groupCartLineItems — hold 병합(부모상품+날짜 완전일치만)', () => {
  it('같은 부모상품 + 같은 수령/반납일 hold 2건 → 그룹 1개, qty=2', () => {
    const items = [
      makeItem({ reservationId: '10', product: PARENT_A }),
      makeItem({ reservationId: '20', product: PARENT_A_CHILD2 }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].qty).toBe(2)
    expect(groups[0].reservationIds).toEqual(['10', '20'])
  })

  it('canonicalReservationId는 항상 가장 먼저 생성된(=숫자로 가장 작은) id — 문자열 비교 아님', () => {
    const items = [
      makeItem({ reservationId: '9' }),
      makeItem({ reservationId: '10' }), // 문자열 비교면 "10" < "9"로 오판되는 케이스
    ]
    const groups = groupCartLineItems(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].canonicalReservationId).toBe('9')
    expect(groups[0].reservationIds).toEqual(['9', '10'])
  })

  it('같은 부모상품이라도 수령일이 다르면 병합하지 않음 — 별도 그룹 2개(Stephen 확정사항 1)', () => {
    const items = [
      makeItem({ reservationId: '10', startDate: '2026-09-01', endDate: '2026-09-03' }),
      makeItem({ reservationId: '20', startDate: '2026-09-05', endDate: '2026-09-07' }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.qty)).toEqual([1, 1])
  })

  it('같은 부모상품이라도 반납일만 다르면 병합하지 않음', () => {
    const items = [
      makeItem({ reservationId: '10', startDate: '2026-09-01', endDate: '2026-09-03' }),
      makeItem({ reservationId: '20', startDate: '2026-09-01', endDate: '2026-09-04' }),
    ]
    const groups = groupCartLineItems(items)
    expect(groups).toHaveLength(2)
  })

  it('부모상품이 다르면 병합하지 않음', () => {
    const items = [
      makeItem({ reservationId: '10', product: PARENT_A }),
      makeItem({ reservationId: '20', product: PARENT_B }),
    ]
    const groups = groupCartLineItems(items)
    expect(groups).toHaveLength(2)
  })
})

describe('groupCartLineItems — draft 병합(부모상품만 일치하면 됨, 날짜 없음)', () => {
  it('같은 부모상품 draft 2건(날짜 전부 빈 문자열) → 그룹 1개로 병합', () => {
    const items = [
      makeItem({ reservationId: '30', product: DRAFT_PARENT_A, status: 'draft', startDate: '', endDate: '' }),
      makeItem({ reservationId: '31', product: DRAFT_PARENT_A, status: 'draft', startDate: '', endDate: '' }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].qty).toBe(2)
  })

  it('hold 예약과 draft 예약은 부모상품이 같아도 절대 병합하지 않음(범위 외 확정)', () => {
    const items = [
      makeItem({ reservationId: '10', product: PARENT_A, status: 'hold' }),
      makeItem({ reservationId: '30', product: DRAFT_PARENT_A, status: 'draft', startDate: '', endDate: '' }),
    ]
    const groups = groupCartLineItems(items)
    expect(groups).toHaveLength(2)
  })
})

describe('groupCartLineItems — 저하(degrade) 케이스', () => {
  it('product가 null이면(자식상품 삭제 등) 항상 단독 그룹 — 크래시 없이 안전 저하', () => {
    const items = [
      makeItem({ reservationId: '10', product: null }),
      makeItem({ reservationId: '20', product: null }),
    ]
    const groups = groupCartLineItems(items)

    // 같은 product=null이어도 서로 다른 예약이므로 병합되면 안 됨
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.qty === 1)).toBe(true)
  })
})

describe('groupCartLineItems — 옵션 합산(그룹 내 전체 멤버 대상)', () => {
  it('두 예약이 서로 다른 옵션을 갖고 있으면 그룹 옵션 목록에 합쳐서 표시', () => {
    const items = [
      makeItem({
        reservationId: '10',
        options: [{ optionProductId: 'opt-1', name: '메모리카드', qty: 1, unitPrice: 5000, imageUrl: null }],
      }),
      makeItem({
        reservationId: '20',
        options: [{ optionProductId: 'opt-2', name: '삼각대', qty: 1, unitPrice: 3000, imageUrl: null }],
      }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].options).toEqual([
      { optionProductId: 'opt-1', name: '메모리카드', qty: 1, unitPrice: 5000, imageUrl: null },
      { optionProductId: 'opt-2', name: '삼각대', qty: 1, unitPrice: 3000, imageUrl: null },
    ])
  })

  it('같은 옵션상품이 두 예약 모두에 있으면 qty를 합산', () => {
    const items = [
      makeItem({
        reservationId: '10',
        options: [{ optionProductId: 'opt-1', name: '메모리카드', qty: 1, unitPrice: 5000, imageUrl: 'img.jpg' }],
      }),
      makeItem({
        reservationId: '20',
        options: [{ optionProductId: 'opt-1', name: '메모리카드', qty: 2, unitPrice: 5000, imageUrl: null }],
      }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups[0].options).toHaveLength(1)
    expect(groups[0].options[0].qty).toBe(3)
    // imageUrl은 두 번째(incoming)에 값이 없으면 첫 번째에서 확보한 값을 보존
    expect(groups[0].options[0].imageUrl).toBe('img.jpg')
  })
})

describe('groupCartLineItems — 그룹 표시 필드는 canonical(최초 생성) 멤버 기준', () => {
  it('가격/방식/기간유형 등은 canonical 멤버의 값을 사용', () => {
    const items = [
      makeItem({ reservationId: '10', price24h: 20000, pickupMethod: 'visit' }),
      makeItem({ reservationId: '20', price24h: 99999, pickupMethod: 'delivery' }),
    ]
    const groups = groupCartLineItems(items)

    expect(groups[0].price24h).toBe(20000)
    expect(groups[0].pickupMethod).toBe('visit')
  })
})
