import { describe, it, expect } from 'vitest'
import { buildOptionLinkFlagIndex, optionLinkFlagsFor, type OptionLinkRow } from '$lib/utils/cartOptionLinkFlags'

/**
 * 장바구니 옵션 링크 플래그(배송 대여 불가·필수·최소 1개 선택·수량 연동·무료) 판정 — TDD (2026-10-01)
 *
 * 배경(SONY UWP-D21 사례): "빠른 재고 등록"이 부모의 옵션 링크를 재고(자식) 상품에 복사해 두었고, 이후 부모 설정을
 * 고쳐도 복사본은 따라가지 않았다. 장바구니가 옵션 id만으로 링크를 읽어 "하나라도 켜져 있으면 켜짐"(OR)으로
 * 판정해, 부모는 꺼짐인데 재고 복사본이 켜져 있다는 이유로 배송 방식이 장바구니에서 사라졌다.
 * 정본은 부모 상품의 링크(상품 상세 get_product_option_links와 동일: product_id=부모, deleted_at IS NULL).
 */

const PARENT = 'parent-1'
const CHILD = 'child-1'
const OTHER_MAIN = 'parent-2'
const OPT = 'opt-1'

function row(over: Partial<OptionLinkRow>): OptionLinkRow {
  return {
    product_id: PARENT,
    option_product_id: OPT,
    delivery_rental_disabled: false,
    is_required: false,
    min_select_required: false,
    qty_follows_main: false,
    is_free: false,
    deleted_at: null,
    ...over,
  }
}

describe('optionLinkFlagsFor — 본상품(부모) 링크만 정본', () => {
  it('OL-1 [사고 재현]: 부모 링크는 배송불가 꺼짐, 재고(자식) 복사본은 켜짐 → 꺼짐(복사본이 새지 않는다)', () => {
    const idx = buildOptionLinkFlagIndex([
      row({ product_id: PARENT, delivery_rental_disabled: false, min_select_required: false }),
      row({ product_id: CHILD, delivery_rental_disabled: true, min_select_required: true }),
    ])
    const f = optionLinkFlagsFor(idx, PARENT, OPT)
    expect(f.deliveryRentalDisabled).toBe(false)
    expect(f.minSelectRequired).toBe(false)
  })

  it('OL-2: 부모 링크가 켜짐이면 켜짐(정상 동작 유지)', () => {
    const idx = buildOptionLinkFlagIndex([row({ delivery_rental_disabled: true, is_required: true, min_select_required: true, qty_follows_main: true })])
    const f = optionLinkFlagsFor(idx, PARENT, OPT)
    expect(f).toEqual({ deliveryRentalDisabled: true, isRequired: true, minSelectRequired: true, qtyFollowsMain: true, isFree: false })
  })

  it('OL-3 [본상품 범위]: 다른 본상품의 링크는 영향을 주지 않는다', () => {
    const idx = buildOptionLinkFlagIndex([
      row({ product_id: OTHER_MAIN, delivery_rental_disabled: true, is_free: true }),
      row({ product_id: PARENT, delivery_rental_disabled: false, is_free: false }),
    ])
    expect(optionLinkFlagsFor(idx, PARENT, OPT).deliveryRentalDisabled).toBe(false)
    expect(optionLinkFlagsFor(idx, PARENT, OPT).isFree).toBe(false)
    expect(optionLinkFlagsFor(idx, OTHER_MAIN, OPT).deliveryRentalDisabled).toBe(true)
    expect(optionLinkFlagsFor(idx, OTHER_MAIN, OPT).isFree).toBe(true)
  })

  it('OL-4: 삭제된(deleted_at) 링크는 무시한다', () => {
    const idx = buildOptionLinkFlagIndex([row({ delivery_rental_disabled: true, is_free: true, deleted_at: '2026-10-01T00:00:00Z' })])
    expect(optionLinkFlagsFor(idx, PARENT, OPT)).toEqual({ deliveryRentalDisabled: false, isRequired: false, minSelectRequired: false, qtyFollowsMain: false, isFree: false })
  })

  it('OL-5: 링크가 없는 옵션·본상품 조합은 전부 false', () => {
    const idx = buildOptionLinkFlagIndex([row({ delivery_rental_disabled: true })])
    expect(optionLinkFlagsFor(idx, PARENT, 'opt-other').deliveryRentalDisabled).toBe(false)
    expect(optionLinkFlagsFor(idx, 'parent-unknown', OPT).deliveryRentalDisabled).toBe(false)
    expect(optionLinkFlagsFor(idx, '', OPT).deliveryRentalDisabled).toBe(false)
  })

  it('OL-6: 같은 본상품에 옵션 여러 개 — 옵션별로 독립 판정', () => {
    const idx = buildOptionLinkFlagIndex([
      row({ option_product_id: 'a', delivery_rental_disabled: true }),
      row({ option_product_id: 'b', delivery_rental_disabled: false, is_free: true }),
    ])
    expect(optionLinkFlagsFor(idx, PARENT, 'a').deliveryRentalDisabled).toBe(true)
    expect(optionLinkFlagsFor(idx, PARENT, 'b').deliveryRentalDisabled).toBe(false)
    expect(optionLinkFlagsFor(idx, PARENT, 'b').isFree).toBe(true)
  })

  it('OL-7: null 플래그(DB null)는 false로 취급', () => {
    const idx = buildOptionLinkFlagIndex([row({ delivery_rental_disabled: null, is_required: null, min_select_required: null, qty_follows_main: null, is_free: null })])
    expect(optionLinkFlagsFor(idx, PARENT, OPT)).toEqual({ deliveryRentalDisabled: false, isRequired: false, minSelectRequired: false, qtyFollowsMain: false, isFree: false })
  })
})
