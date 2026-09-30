// 정시반납(on_time_return) 포인트 자동적립 — 공용 fail-soft 헬퍼.
// awardRentalCompletePoints.ts와 동일한 3개 호출 지점(QR 반납·두발히어로 자동전이·
// CMS 수동 반납)에서 함께 호출된다 — log_rental_action 이중 배선과 동일 패턴.
// H-01: 직접 DML 금지 — award_on_time_return_points RPC(Migration #597) 경유만 허용.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export async function awardOnTimeReturnPoints(
  admin: AnyClient,
  reservationId: number,
): Promise<void> {
  try {
    await admin.rpc('award_on_time_return_points', {
      p_reservation_id: reservationId,
    })
  } catch {
    /* 포인트 적립 실패는 메인 상태전이 흐름에 영향을 주지 않음(fail-soft) */
  }
}
