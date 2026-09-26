import type { SupabaseClient } from '@supabase/supabase-js'

export const IDENTITY_APPROVED_LOCK_MESSAGE = '관리자가 승인한 증명서는 수정·삭제할 수 없어요.'

// 승인 판정 = *_approved_at 이 있고 제출시각(*_verified_at) 이후 — migration #526 "검토 대기"
// 판정식의 반대. 고객 본인증명·외국인증명 수정·삭제 API 3곳이 공통으로 사용한다.
export async function isIdentityApproved(
  admin: SupabaseClient,
  userId: string,
  docType: 'identity' | 'foreign' = 'identity',
): Promise<boolean> {
  const verifiedCol = `${docType}_verified_at`
  const approvedCol = `${docType}_approved_at`
  const { data, error } = await admin
    .from('user_profiles')
    .select(`${verifiedCol}, ${approvedCol}`)
    .eq('user_id', userId)
    .maybeSingle()
  // 조회 실패 시 잠금이 조용히 열리지 않도록 승인된 것으로 간주(fail-closed)
  if (error) {
    console.error('[identityApproval] 승인 상태 조회 실패 — 안전측 차단:', error.message)
    return true
  }
  const row = data as Record<string, string | null> | null
  const approvedAt = row?.[approvedCol]
  if (!approvedAt) return false
  const verifiedAt = row?.[verifiedCol]
  if (!verifiedAt) return true
  return new Date(approvedAt).getTime() >= new Date(verifiedAt).getTime()
}
