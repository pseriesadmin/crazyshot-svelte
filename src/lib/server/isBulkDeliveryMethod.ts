// src/lib/server/isBulkDeliveryMethod.ts
// "배송대여" 판별 유틸 — rental_method_options.is_bulk_delivery 플래그 기반
//
// 핵심 설계: pickup_method/return_method 리터럴 하드코딩 비교 절대 금지 (TASK.md 핵심제약).
// 관리자가 /cms/set/rental에서 그룹을 변경해도 코드 수정 없이 즉시 반영된다.
//
// §조사결과 D: method_key IN ('delivery','crazydelivery')가 기본 시딩값이지만
// toggle_rental_method_bulk_delivery RPC로 언제든 변경 가능 → DB 조회로만 판단.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

/**
 * 주어진 method_key가 "배송대여(bulk delivery)" 그룹인지 DB 조회로 판정.
 * @param admin service_role 클라이언트 (rental_method_options RLS 우회 필요)
 * @param methodKey pickup_method 또는 return_method 값
 * @returns true = bulk delivery(두발히어로 연동 대상), false = 기타(방문/퀵/보관함 등)
 */
export async function isBulkDeliveryMethod(
  admin: AnySupabaseClient,
  methodKey: string | null | undefined,
): Promise<boolean> {
  if (!methodKey) return false

  const { data, error } = await admin
    .from('rental_method_options')
    .select('is_bulk_delivery')
    .eq('method_key', methodKey)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return false
  return (data as { is_bulk_delivery: boolean }).is_bulk_delivery === true
}
