/**
 * 장바구니 수령/반납 방식 콤보바 — 선택값 판정 순수함수.
 * cart/+page.svelte의 인라인 로직(toDeliveryMethod / methodSelectionValid)을 추출해
 * 단위테스트 가능하게 분리한다(cartRentalFee.ts / cartShippingFee.ts와 동일한 패턴).
 *
 * 배경(2026-09-04): 최초 카트 진입 시 신규 카트 아이템의 rentalMethod/returnMethod
 * 기본값이 'visit'(방문)으로 강제 세팅돼, 콤보 버튼 바에 이미 '방문'이 선택된 것처럼
 * 보이던 결함(TASK.md "장바구니 수령/반납 방식 콤보바 최초진입 시 '방문' 오선택 표시
 * 제거" 참고). defaultOptions()의 기본값을 null(완전 미선택)로 바꾸면서, null을 다루는
 * 판정 로직도 함께 이 파일로 옮겨 회귀를 테스트로 고정한다.
 */

export type DeliveryMethod = 'crazydelivery' | 'quick' | 'locker' | 'visit' | 'epost' | 'delivery'

const KNOWN_DELIVERY_METHODS: readonly DeliveryMethod[] = ['crazydelivery', 'quick', 'locker', 'visit', 'epost', 'delivery']

/**
 * 상품 상세에서 저장된 값(seed) → 체크아웃 표시값 매핑.
 * v가 알려진 방식이 아니면 fallback을 그대로 반환한다. fallback 자체도 null일 수 있다 —
 * 최초진입 시 "완전 미선택" 상태(defaultOptions())를 표현하기 위함(2026-09-04).
 * fallback이 non-null인 호출부(예: incrementGroupQtyImmediate의 기존 DB저장값 복제 경로)는
 * 그대로 non-null 값을 계속 돌려받는다 — 이 함수 자체의 동작은 변경되지 않았다.
 */
export function toDeliveryMethod(v: string | null, fallback: DeliveryMethod | null): DeliveryMethod | null {
  return v && (KNOWN_DELIVERY_METHODS as readonly string[]).includes(v) ? (v as DeliveryMethod) : fallback
}

export interface DeliveryTabMeta {
  v: DeliveryMethod
}

/**
 * 콤보 탭 목록(visibleTabs) 대비 현재 선택값이 유효한지 판정.
 * 삭제됐거나 체크 해제된 항목은 검증 대상에서 제외돼 항상 valid.
 * rentalMethod/returnMethod가 null(미선택)이면 어떤 tab.v와도 일치하지 않아 항상
 * invalid — "최초진입 시 미선택 상태에서는 예약신청완료 버튼이 막힌다"는 기존 안전장치를
 * null 허용 이후에도 그대로 보존한다(별도 null 특수분기 불필요).
 */
export function isMethodSelectionValid(params: {
  deleted: boolean
  checked: boolean
  rentalMethod: DeliveryMethod | null
  returnMethod: DeliveryMethod | null
  pickupVisibleTabs: DeliveryTabMeta[]
  returnVisibleTabs: DeliveryTabMeta[]
}): boolean {
  if (params.deleted || !params.checked) return true
  return (
    params.pickupVisibleTabs.some(t => t.v === params.rentalMethod) &&
    params.returnVisibleTabs.some(t => t.v === params.returnMethod)
  )
}
