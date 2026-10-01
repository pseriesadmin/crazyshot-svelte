/**
 * 장바구니 옵션 링크 플래그 판정 — 본상품(부모)의 링크만 정본으로 삼는다 (2026-10-01).
 *
 * product_option_links는 (본상품 id, 옵션상품 id) 쌍으로 설정되며, CMS에서 편집하는 정본은 부모 상품의 링크다
 * (상품 상세 get_product_option_links도 product_id=부모, deleted_at IS NULL만 읽는다).
 * 재고(자식) 상품에 복사돼 남은 링크나 다른 본상품의 링크가 섞이면 부모 설정과 다른 값이 장바구니에 새어
 * 배송 방식이 사라지는 등의 불일치가 생기므로, 키를 `본상품:옵션` 쌍으로 만들어 이 쌍의 링크만 읽는다.
 */

export interface OptionLinkRow {
  product_id: string
  option_product_id: string
  delivery_rental_disabled: boolean | null
  is_required: boolean | null
  min_select_required: boolean | null
  qty_follows_main: boolean | null
  is_free: boolean | null
  deleted_at: string | null
}

export interface OptionLinkFlags {
  deliveryRentalDisabled: boolean
  isRequired: boolean
  minSelectRequired: boolean
  qtyFollowsMain: boolean
  isFree: boolean
}

const NO_FLAGS: OptionLinkFlags = {
  deliveryRentalDisabled: false,
  isRequired: false,
  minSelectRequired: false,
  qtyFollowsMain: false,
  isFree: false,
}

function linkKey(mainProductId: string, optionProductId: string): string {
  return `${mainProductId}:${optionProductId}`
}

/** 링크 행 → `본상품:옵션` 키 인덱스. 삭제된 링크(deleted_at)는 제외한다. */
export function buildOptionLinkFlagIndex(rows: OptionLinkRow[]): Map<string, OptionLinkFlags> {
  const index = new Map<string, OptionLinkFlags>()
  for (const l of rows) {
    if (l.deleted_at) continue
    const key = linkKey(l.product_id, l.option_product_id)
    const prev = index.get(key) ?? NO_FLAGS
    // (본상품, 옵션) 쌍은 DB 유니크 제약이라 보통 1행이지만, 중복이 있어도 보수적으로 OR 합산한다.
    index.set(key, {
      deliveryRentalDisabled: prev.deliveryRentalDisabled || !!l.delivery_rental_disabled,
      isRequired: prev.isRequired || !!l.is_required,
      minSelectRequired: prev.minSelectRequired || !!l.min_select_required,
      qtyFollowsMain: prev.qtyFollowsMain || !!l.qty_follows_main,
      isFree: prev.isFree || !!l.is_free,
    })
  }
  return index
}

/** 이 본상품(재고 예약이면 부모로 환산한 id)에 연결된 옵션의 플래그. 링크가 없으면 전부 false. */
export function optionLinkFlagsFor(
  index: Map<string, OptionLinkFlags>,
  mainProductId: string,
  optionProductId: string,
): OptionLinkFlags {
  if (!mainProductId || !optionProductId) return NO_FLAGS
  return index.get(linkKey(mainProductId, optionProductId)) ?? NO_FLAGS
}
