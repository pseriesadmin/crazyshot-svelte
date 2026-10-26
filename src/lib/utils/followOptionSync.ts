// 장바구니: 본상품 수량 변경 시 "수량 본상품 연동"(product_option_links.qty_follows_main) 옵션 수량 동기화 계획 (2026-10-26)
// 규칙은 상품상세 OPT-QTYLOCK-1과 같다 — 필수 연동 옵션은 항상 본상품 수량, 선택(필수 아님) 연동 옵션은 고객이 담은 경우(qty>0)에만 따라간다.
// 재고가 모자라면 min(본상품 수량, 재고), 재고가 0이면 건드리지 않는다. 서버(set_reservation_options)가 같은 규칙으로 한 번 더 보정한다.
export interface FollowSyncOption {
  optionProductId: string | null
  name: string
  qty: number
  unitPrice: number
  qtyFollowsMain: boolean
  isRequired: boolean
}

export interface FollowSyncPayloadItem {
  option_product_id: string | null
  option_name: string
  qty: number
  unit_price: number
}

export interface FollowQtyOpts {
  // 재고 상한에 이 옵션의 현재(저장된) 수량을 더한다 — 장바구니의 "남은 재고" 숫자는 이 그룹이 이미 점유한 옵션 수량을 뺀 값이라(hold 예약의 옵션 실물 배정),
  // 서버(set_reservation_options)가 자기 몫을 빼지 않고 계산하는 것과 맞추려면 hold 그룹에서 켠다. 임시예약(draft)은 점유가 없어 켜지 않는다. (sp3 MAJOR-2, 2026-10-26)
  includeOwnQty?: boolean
  // 서버에서 불러온 본상품 수량 — 지금 본상품 수량과 같으면 수량 변경이 없는 것이라 서버 저장 수량을 그대로 보여준다(withFollowOptionQty 전용)
  serverMainQty?: number
}

// 연동 옵션 한 개의 목표 수량 — 연동 대상이 아니거나 건드리지 않아야 하면 null
function followTargetQty(
  o: FollowSyncOption,
  mainQty: number,
  stockCapFor: (optionProductId: string | null) => number,
  opts?: FollowQtyOpts,
): number | null {
  if (!o.qtyFollowsMain || !o.optionProductId) return null
  if (!(o.isRequired || o.qty > 0)) return null
  const stock = stockCapFor(o.optionProductId) + (opts?.includeOwnQty ? o.qty : 0)
  const target = Math.min(mainQty, stock)
  return target >= 1 && target !== o.qty ? target : null
}

// 화면 표시용 — 본상품 수량에 맞춰 연동 옵션 수량을 바꾼 새 옵션 목록(원본·다른 필드 불변). 바뀔 옵션이 없으면 같은 배열을 그대로 돌려준다.
export function withFollowOptionQty<T extends FollowSyncOption>(
  options: T[],
  mainQty: number,
  stockCapFor: (optionProductId: string | null) => number,
  opts?: FollowQtyOpts,
): T[] {
  if (opts?.serverMainQty !== undefined && mainQty === opts.serverMainQty) return options
  let changed = false
  const next = options.map((o) => {
    const t = followTargetQty(o, mainQty, stockCapFor, opts)
    if (t === null) return o
    changed = true
    return { ...o, qty: t }
  })
  return changed ? next : options
}

export function planFollowOptionSync(
  options: FollowSyncOption[],
  mainQty: number,
  stockCapFor: (optionProductId: string | null) => number,
  opts?: FollowQtyOpts,
): { changed: boolean; payload: FollowSyncPayloadItem[] } {
  let changed = false
  const payload = options.map((o) => {
    const t = followTargetQty(o, mainQty, stockCapFor, opts)
    if (t !== null) changed = true
    return { option_product_id: o.optionProductId, option_name: o.name, qty: t ?? o.qty, unit_price: o.unitPrice }
  })
  return { changed, payload }
}
