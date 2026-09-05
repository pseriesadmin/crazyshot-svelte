// src/lib/utils/cartLineGrouping.ts
// 장바구니 동일 부모상품 중복담기 → 하나로 병합 (2026-08-28, Stephen GATE B 승인)
//
// 순수 함수 — DB 접근 없음. 예약행(reservation) 1건 = 재고 1대 배정이라는 기존 원칙은 그대로
// 유지하면서(products.md §1/§5), 카트 "표시" 레이어에서만 같은 부모상품+같은 날짜(hold) 또는
// 같은 부모상품(draft, 날짜 없음)인 예약행들을 하나의 카드로 묶는다.
//
// 병합 조건(Stephen 확정):
//   hold  — parent_product_id + start_date + end_date가 완전히 같을 때만 병합
//   draft — parent_product_id만 같으면 병합(날짜가 아직 없으므로)
//   그 외(product 해석 불가 등)는 항상 단독 그룹으로 안전 저하 — 절대 크래시하지 않음.

import { resolveParentProductId, mergeReservationOptions, type ReservationOptionInput } from '$lib/services/reservationHelper'

export interface CartLineItemOption {
  optionProductId: string | null
  name: string
  qty: number
  unitPrice: number
  unitPrice12h: number | null
  imageUrl: string | null
  deliveryRentalDisabled: boolean
  isRequired: boolean
  minSelectRequired: boolean
}

export interface GroupableProduct {
  id: string
  parent_product_id?: string | null
}

export interface GroupableLineItem {
  reservationId: string
  productId: string | null
  product: GroupableProduct | null
  price12h: number | null
  price24h: number | null
  deposit: number | null
  startDate: string
  endDate: string
  pickupMethod: string | null
  returnMethod: string | null
  pickupTime: string | null
  returnTime: string | null
  durationType: string | null
  options: CartLineItemOption[]
  status: string
}

export interface CartLineGroup {
  groupKey: string
  canonicalReservationId: string
  reservationIds: string[]
  qty: number
  productId: string | null
  product: GroupableProduct | null
  price12h: number | null
  price24h: number | null
  deposit: number | null
  startDate: string
  endDate: string
  pickupMethod: string | null
  returnMethod: string | null
  pickupTime: string | null
  returnTime: string | null
  durationType: string | null
  options: CartLineItemOption[]
  status: string
}

function resolveGroupKey(item: GroupableLineItem): string {
  const parentId = resolveParentProductId(item.product)
  if (!parentId) return `single:${item.reservationId}`
  if (item.status === 'hold') return `hold:${parentId}:${item.startDate}:${item.endDate}`
  if (item.status === 'draft') return `draft:${parentId}`
  return `single:${item.reservationId}`
}

function toOptionInput(o: CartLineItemOption): ReservationOptionInput {
  return { option_product_id: o.optionProductId, option_name: o.name, qty: o.qty, unit_price: o.unitPrice }
}

function fromOptionInput(
  o: ReservationOptionInput,
  imageUrlByProductId: Map<string, string | null>,
  unitPrice12hByProductId: Map<string, number | null>,
  deliveryDisabledByProductId: Map<string, boolean>,
  requiredByProductId: Map<string, boolean>,
  minSelectByProductId: Map<string, boolean>
): CartLineItemOption {
  return {
    optionProductId: o.option_product_id,
    name: o.option_name,
    qty: o.qty,
    unitPrice: o.unit_price,
    // 2026-09-03(Stephen 확정) — 옵션 12h 요금은 mergeReservationOptions(ReservationOptionInput)이
    // 다루지 않는 표시·계산 전용 필드라 imageUrl과 동일한 패턴으로 별도 복원(옵션 상품 자체의
    // price_rules에서 조회한 독립 12h 가격 — unit_price/2로 파생시키지 않음).
    unitPrice12h: o.option_product_id ? (unitPrice12hByProductId.get(o.option_product_id) ?? null) : null,
    imageUrl: o.option_product_id ? (imageUrlByProductId.get(o.option_product_id) ?? null) : null,
    // 배송대여 불가(product_option_links.delivery_rental_disabled) — imageUrl/unitPrice12h와
    // 동일한 패턴의 표시·판정 전용 필드(옵션상품 1개당 고정값). 장바구니 배송방식 선택 제한에 사용.
    deliveryRentalDisabled: o.option_product_id ? (deliveryDisabledByProductId.get(o.option_product_id) ?? false) : false,
    // 필수/최소1개선택(product_option_links.is_required/min_select_required, 2026-09-05) —
    // 위 deliveryRentalDisabled와 동일한 패턴의 표시 전용 필드. products/[id] 옵션선택 UI의
    // "필수"/"최소 1개 선택" 배지와 동일 데이터를 카트 화면에도 노출하기 위해 추가.
    isRequired: o.option_product_id ? (requiredByProductId.get(o.option_product_id) ?? false) : false,
    minSelectRequired: o.option_product_id ? (minSelectByProductId.get(o.option_product_id) ?? false) : false,
  }
}

function compareReservationIdsAsc(a: string, b: string): number {
  const diff = BigInt(a) - BigInt(b)
  return diff < 0n ? -1 : diff > 0n ? 1 : 0
}

export function groupCartLineItems(items: GroupableLineItem[]): CartLineGroup[] {
  const groupOrder: string[] = []
  const buckets = new Map<string, GroupableLineItem[]>()

  for (const item of items) {
    const key = resolveGroupKey(item)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(key, [item])
      groupOrder.push(key)
    }
  }

  return groupOrder.map((key) => {
    const members = buckets.get(key) as GroupableLineItem[]
    const reservationIds = members.map((m) => m.reservationId).sort(compareReservationIdsAsc)
    const canonicalReservationId = reservationIds[0]
    const canonical = members.find((m) => m.reservationId === canonicalReservationId) as GroupableLineItem

    // 옵션상품 imageUrl·unitPrice12h는 mergeReservationOptions가 다루지 않는 표시·계산 전용
    // 필드라 별도 복원(둘 다 option_product_id 1개당 고정값 — reservation마다 달라지지 않음)
    const imageUrlByProductId = new Map<string, string | null>()
    const unitPrice12hByProductId = new Map<string, number | null>()
    const deliveryDisabledByProductId = new Map<string, boolean>()
    const requiredByProductId = new Map<string, boolean>()
    const minSelectByProductId = new Map<string, boolean>()
    for (const m of members) {
      for (const o of m.options) {
        if (o.optionProductId && !imageUrlByProductId.get(o.optionProductId)) {
          imageUrlByProductId.set(o.optionProductId, o.imageUrl)
        }
        if (o.optionProductId && unitPrice12hByProductId.get(o.optionProductId) == null) {
          unitPrice12hByProductId.set(o.optionProductId, o.unitPrice12h)
        }
        if (o.optionProductId && !deliveryDisabledByProductId.get(o.optionProductId)) {
          deliveryDisabledByProductId.set(o.optionProductId, o.deliveryRentalDisabled)
        }
        if (o.optionProductId && !requiredByProductId.get(o.optionProductId)) {
          requiredByProductId.set(o.optionProductId, o.isRequired)
        }
        if (o.optionProductId && !minSelectByProductId.get(o.optionProductId)) {
          minSelectByProductId.set(o.optionProductId, o.minSelectRequired)
        }
      }
    }

    let mergedOptions: ReservationOptionInput[] = []
    for (const m of members) {
      mergedOptions = mergeReservationOptions(mergedOptions, m.options.map(toOptionInput))
    }

    return {
      groupKey: key,
      canonicalReservationId,
      reservationIds,
      qty: reservationIds.length,
      productId: canonical.productId,
      product: canonical.product,
      price12h: canonical.price12h,
      price24h: canonical.price24h,
      deposit: canonical.deposit,
      startDate: canonical.startDate,
      endDate: canonical.endDate,
      pickupMethod: canonical.pickupMethod,
      returnMethod: canonical.returnMethod,
      pickupTime: canonical.pickupTime,
      returnTime: canonical.returnTime,
      durationType: canonical.durationType,
      status: canonical.status,
      options: mergedOptions.map((o) => fromOptionInput(o, imageUrlByProductId, unitPrice12hByProductId, deliveryDisabledByProductId, requiredByProductId, minSelectByProductId)),
    }
  })
}
