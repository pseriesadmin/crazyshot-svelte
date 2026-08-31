// 대여완료(rental_complete) 포인트 자동적립 — 공용 fail-soft 헬퍼.
// QR 반납 경로(rentalQrTransition.ts)와 수동 반납 경로(cms/reservation/+page.server.ts
// updateStatus)가 동일하게 재사용한다 — log_rental_action 이중 배선과 동일 패턴.
// H-01: 직접 DML 금지 — award_rental_complete_points RPC(Migration #407) 경유만 허용.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export async function awardRentalCompletePoints(
  admin: AnyClient,
  reservationId: number,
): Promise<void> {
  try {
    await admin.rpc('award_rental_complete_points', {
      p_reservation_id: reservationId,
    })
  } catch {
    /* 포인트 적립 실패는 메인 상태전이 흐름에 영향을 주지 않음(fail-soft) */
  }
}
