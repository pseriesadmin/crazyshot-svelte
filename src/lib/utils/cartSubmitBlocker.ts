// 장바구니 "예약신청" 제출을 막는 가장 먼저 빠진 항목 안내 문구 (2026-10-05)
// 이전에는 어떤 항목이 빠져도 "미입력 항목을 확인하세요" 한 문구였다 — 고객이 수령일만 고르고 달력이 닫힌 경우처럼
// 무엇이 빠졌는지 알 수 없어 이탈하던 문제를 줄이기 위해, 화면 위에서 아래 순서대로 첫 번째 빠진 항목을 알려 준다.
// 판정 기준은 cart/+page.svelte의 readyToSubmit 구성요소(datesSet·pickupPointsSet·formsComplete·methodSelectionValid·
// deadlineOk·priceUnsetBlocked·agreed)와 같다 — 제출 게이트를 바꾸면 이 함수의 입력도 함께 갱신해야 한다.

export interface CartSubmitBlockerInput {
  hasItems: boolean
  methodInvalid: boolean
  rentalDateMissing: boolean
  rentalTimeMissing: boolean
  returnDateMissing: boolean
  returnTimeMissing: boolean
  rentalPointMissing: boolean
  returnPointMissing: boolean
  /** 수령 정보 폼에서 비어 있는 항목 라벨(순서 고정) */
  rentalFormMissing: string[]
  /** 반납 정보 폼에서 비어 있는 항목 라벨 */
  returnFormMissing: string[]
  deadlineOk: boolean
  priceUnset: boolean
  agreed: boolean
}

/** 가장 먼저 빠진 항목의 안내 문구. 막는 항목이 없으면 null. */
export function firstCartSubmitBlocker(i: CartSubmitBlockerInput): string | null {
  if (!i.hasItems) return '예약할 상품을 선택해주세요.'
  if (i.methodInvalid) return '수령·반납 방법을 선택해주세요.'
  if (i.rentalDateMissing) return '수령일을 선택해주세요.'
  if (i.rentalTimeMissing) return '수령 시간을 선택해주세요.'
  if (i.returnDateMissing) return '반납일을 선택해주세요.'
  if (i.returnTimeMissing) return '반납 시간을 선택해주세요.'
  if (i.rentalPointMissing) return '수령 방문지점을 선택해주세요.'
  if (i.returnPointMissing) return '반납 방문지점을 선택해주세요.'
  if (i.rentalFormMissing.length > 0) return `수령 정보의 ${i.rentalFormMissing.join(', ')} 항목을 입력해주세요.`
  if (i.returnFormMissing.length > 0) return `반납 정보의 ${i.returnFormMissing.join(', ')} 항목을 입력해주세요.`
  if (!i.deadlineOk) return '선택한 수령일의 신청 마감 시각이 지났어요. 수령일을 다시 선택해주세요.'
  if (i.priceUnset) return '요금이 정해지지 않은 상품은 예약할 수 없어요. 해당 상품의 체크를 해제해주세요.'
  if (!i.agreed) return '이용 약관에 동의해주세요.'
  return null
}
