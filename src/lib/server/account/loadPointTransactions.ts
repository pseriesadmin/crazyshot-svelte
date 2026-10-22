// 내정보 > 포인트 탭 — 내 포인트 적립·사용 내역(최신순) 조회
// account/+page.server.ts(PC)와 account/profile/+page.server.ts(모바일)가 공유.
// point_transactions 는 RLS(pt_user_select: user_id = auth.uid())로 본인 행만 읽힌다 — 로그인 세션 클라이언트로 조회한다.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PointTransactionCard {
  id: string
  /** earn 적립 · use 사용 · expire 소멸 · admin_grant 관리자 지급 · admin_deduct 관리자 차감 · refund 환불 */
  type: string
  /** 부호 있는 변동량(적립 +, 사용·소멸 −) */
  amount: number
  balanceAfter: number
  description: string | null
  refType: string | null
  createdAt: string
  expiresAt: string | null
}

const MAX_ROWS = 100

export async function loadPointTransactions(supabase: SupabaseClient, userId: string): Promise<PointTransactionCard[]> {
  const { data, error } = await supabase
    .from('point_transactions')
    .select('id, type, amount, balance_after, description, ref_type, created_at, expires_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error) {
    console.error('[account/points] point_transactions error:', error)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    amount: r.amount as number,
    balanceAfter: r.balance_after as number,
    description: (r.description as string | null) ?? null,
    refType: (r.ref_type as string | null) ?? null,
    createdAt: r.created_at as string,
    expiresAt: (r.expires_at as string | null) ?? null,
  }))
}
