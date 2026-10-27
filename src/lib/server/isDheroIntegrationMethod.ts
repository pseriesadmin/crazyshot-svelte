// src/lib/server/isDheroIntegrationMethod.ts
// 두발히어로 연동 대상 방식 판정 — rental_method_options.is_dhero_integration (Migration #772, 2026-10-27)
//
// ⓪ 스위치 분리: 예전에는 장바구니 "요청 A" 전용 스위치(is_bulk_delivery)를 재사용(isBulkDeliveryMethod)해
// 장바구니 UX 를 만지면 두발히어로 접수가 따라 켜지고 꺼졌다. 이제 연동 판정은 이 전용 컬럼 하나만 본다.
// 장바구니 요청 A·배송비·휴무일 판정은 이 유틸과 무관하다.
//
// 핵심 설계: pickup_method/return_method 리터럴 하드코딩 비교 절대 금지.
// 관리자가 /cms/set/rental 에서 바꾸면 코드 수정 없이 즉시 반영된다.
// fail-safe: 조회 오류·방식 없음·컬럼 없음(마이그레이션 미적용 환경)은 전부 false(연동 꺼짐) — 외부 호출이 새어 나가지 않는다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

/**
 * 주어진 method_key 가 두발히어로 연동 대상인지 DB 조회로 판정.
 * @param admin service_role 클라이언트 (rental_method_options RLS 우회 필요)
 * @param methodKey pickup_method 또는 return_method 값
 * @returns true = 연동 대상(새 배송 접수·반품 접수·주소 사전 확인), false = 그 외
 * ⚠ 이미 운송장(bookId)이 저장된 예약의 취소·상태 동기화는 이 유틸을 거치지 않는다(운송장 유무로 판단 — 4번 작업에서 재검토)
 */
export async function isDheroIntegrationMethod(
  admin: AnySupabaseClient,
  methodKey: string | null | undefined,
): Promise<boolean> {
  if (!methodKey) return false

  const { data, error } = await admin
    .from('rental_method_options')
    .select('is_dhero_integration')
    .eq('method_key', methodKey)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return false
  return (data as { is_dhero_integration: boolean }).is_dhero_integration === true
}
