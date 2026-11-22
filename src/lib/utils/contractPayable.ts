/**
 * 서명은 끝났고 결제만 남은 예약("서명 완료 → 결제 이어가기") 판정과 DB 조회 결과 읽기 헬퍼.
 *
 * 이 판정은 두 곳이 함께 쓴다 — 고객 열람 페이지(/account/rental/[id]/contract)의 결제 이어가기 이동과
 * 관리자 채팅의 고객 화면 미리보기(/api/cms/contracts/[id]/customer-view). 식을 따로 두면 정책이 바뀔 때
 * 한쪽만 고쳐지는 불일치가 생기므로(sp3 검수 2026-11-22) 이 파일 한 곳만 고친다.
 */

/** 신청대기(hold)이고 결제 확인 시각이 없으면 "결제 대기" — 만료·취소·결제완료(confirmed 등)는 해당 없음. */
export function isContractPaymentPending(
  status: string | null | undefined,
  paymentConfirmedAt: string | null | undefined,
): boolean {
  return status === 'hold' && !paymentConfirmedAt
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asIdOrNull(v: unknown): string | number | null {
  return typeof v === 'string' || typeof v === 'number' ? v : null
}

/** contract_signings 행(+ contracts 조인)에서 서명 링크 토큰·서명 시각·예약 id 를 안전하게 읽는다. */
export function readSigningRef(row: unknown): { token: string | null; signedAt: string | null; reservationId: string | number | null } {
  const r = asRecord(row)
  const contracts = asRecord(r?.contracts)
  return {
    token: typeof r?.token === 'string' ? r.token : null,
    signedAt: typeof r?.signed_at === 'string' ? r.signed_at : null,
    reservationId: asIdOrNull(contracts?.reservation_id),
  }
}

/** rental_reservations 행에서 결제 판정에 쓰는 두 값만 읽는다. */
export function readReservationPayState(row: unknown): { status: string | null; paymentConfirmedAt: string | null } {
  const r = asRecord(row)
  return {
    status: typeof r?.status === 'string' ? r.status : null,
    paymentConfirmedAt: typeof r?.payment_confirmed_at === 'string' ? r.payment_confirmed_at : null,
  }
}
