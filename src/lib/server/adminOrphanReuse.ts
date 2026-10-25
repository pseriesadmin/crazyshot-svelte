import type { SupabaseClient } from '@supabase/supabase-js'

// 관리자 계정 생성 시 이미 가입된 이메일을 "고아 계정"으로 재사용해도 되는지 판단한다 (2026-10-24, sp5 SEC-003).
// 재사용 허용: 한 번도 로그인한 적 없고 예약 이력도 없는 계정(관리자 초대 중 중단된 계정 등).
// 거절: 로그인 이력이 있거나 예약 이력이 있는 계정 = 일반 회원 계정 → 관리자로 전환하면 그 고객 계정이 넘어간다.
// 확인 중 오류가 나면 안전한 쪽(거절)으로 처리한다.
export async function canReuseAuthUserAsAdmin(
  admin: SupabaseClient,
  existing: { id: string; last_sign_in_at?: string | null },
): Promise<boolean> {
  if (existing.last_sign_in_at) return false
  const { count, error } = await admin
    .from('rental_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', existing.id)
  if (error) return false
  return (count ?? 0) === 0
}
