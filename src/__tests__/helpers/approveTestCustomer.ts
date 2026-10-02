import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 통합 테스트용 임시 고객을 "본인증명 승인 완료" 상태로 만든다(2026-10-02).
 * 예약 생성은 필수 서류 등록 + 관리자 승인이 없으면 DB 트리거(Migration #629~#632)가 막으므로,
 * 고객 JWT로 hold/draft를 만드는 테스트는 임시 사용자 생성 직후 이 헬퍼를 호출한다.
 * user_profiles 행은 가입 트리거(handle_new_user)가 만든다.
 */
export async function approveTestCustomer(admin: SupabaseClient, userId: string): Promise<void> {
  const verifiedAt = new Date(Date.now() - 60_000).toISOString()
  const { error } = await admin
    .from('user_profiles')
    .update({
      identity_doc_url: ['test/resident.png', 'test/resident_copy.png'],
      identity_type: ['resident', 'resident_copy'],
      identity_verified_at: verifiedAt,
      identity_approved_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
  if (error) throw new Error(`테스트 고객 승인 처리 실패: ${error.message}`)
}
