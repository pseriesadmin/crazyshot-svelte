/**
 * 장바구니 수령·반납 입력 정보 완전성 — "예약신청" 게이트(2026-10-02, Stephen 확정).
 * 이름·전자메일·휴대번호·기본주소·상세주소를 빠짐없이 입력해야 한다(요청 사항은 선택 항목이라 제외 — Stephen 확정)(수령 방식 무관 —
 * 방문·무인보관함·퀵·택배 모두 계약서의 {{주소}}·연락처 정본이 된다). 공백만 입력한 값은 비어 있는 것으로 본다.
 * 방문지점 선택은 이 함수가 아니라 pickupPointsSet이 따로 확인한다.
 */
export interface CartFormInput {
  name: string
  email: string
  phone: string
  addr: string
  addrDetail: string
  /** 선택 항목 — 완전성 판정에서 제외(빈 폼 판정에만 쓴다) */
  notes: string
}

const FIELD_LABELS: Array<[keyof CartFormInput, string]> = [
  ['name', '이름'],
  ['email', '전자메일'],
  ['phone', '휴대번호'],
  ['addr', '기본주소'],
  ['addrDetail', '상세주소'],
]

/** 비어 있는 항목의 한글 라벨 목록(순서 고정). */
export function missingCartFormFields(form: CartFormInput): string[] {
  return FIELD_LABELS.filter(([key]) => (form[key] ?? '').trim() === '').map(([, label]) => label)
}

export function isCartFormComplete(form: CartFormInput): boolean {
  return missingCartFormFields(form).length === 0
}

/**
 * 고객 정보(이름·전자메일·휴대번호)와 주소(기본주소·상세주소)가 모두 입력됐는가 — 요청 사항은 제외.
 * 수령 폼 입력이 끝났을 때 반납 방법 선택 시 그 정보를 반납에 자동 적용할지 판정한다(2026-10-02).
 */
export function isCustomerAndAddressComplete(form: CartFormInput): boolean {
  return isCartFormComplete(form)
}

/** 모든 입력 항목이 비어 있는가(공백만 있는 값 포함) — 자동 적용이 사용자가 직접 입력한 값을 덮어쓰지 않게 한다. */
export function isCartFormEmpty(form: CartFormInput): boolean {
  return missingCartFormFields(form).length === FIELD_LABELS.length && (form.notes ?? '').trim() === ''
}
