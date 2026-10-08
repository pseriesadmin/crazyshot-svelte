// engagement.ts — "관리자가 지금 이 대화를 응대 중인가" 판정 (서버 전용)
//
// 크레이지챗(조회·접수·추천·AI)은 관리자가 응대 중인 세션에는 끼어들지 않는다.
// 과거에는 chat_sessions.admin_id가 한 번이라도 채워지면(= 사람이 한 번이라도 답한 적 있으면) 영구히 "응대 중"으로 보았다 —
// admin_id는 지워지지 않으므로 일반 상담 세션의 절반 가까이가 크레이지챗 대상에서 영구 제외되는 결함이었다(2026-10-08).
//
// 규칙(Stephen 확정, 30분):
//   · admin_id가 없으면 응대 중이 아니다(사람이 답한 적 없음).
//   · admin_id가 있어도 "마지막 관리자 답변"이 30분 미만 전일 때만 응대 중이다. 30분이 지나면 크레이지챗이 다시 응대할 수 있다.
//   · 판정에 실패하면(조회 오류·시각 해석 불가·미래 시각) 안전하게 응대 중으로 본다 — 크레이지챗이 끼어들지 않고 기존 흐름이 이어진다.
// 참고: sender_type='admin'에는 사람의 답장뿐 아니라 빠른답변 자동응답·예약 알림 카드도 포함된다(구분할 컬럼이 없음).
//       admin_id가 있는 세션에서 그런 메시지가 30분 이내에 있었다면 응대 중으로 보게 되지만, 이는 "끼어들지 않는" 안전한 쪽의 오차다.

import type { AdminClient } from './shared'

export const ADMIN_ENGAGED_WINDOW_MINUTES = 30

/** 순수 판정: 마지막 관리자 답변 시각으로 응대 중 여부를 정한다. */
export function evaluateAdminEngaged(
  adminId: string | null | undefined,
  lastAdminMessageAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!adminId) return false
  if (!lastAdminMessageAt) return false
  const t = Date.parse(lastAdminMessageAt)
  if (Number.isNaN(t)) return true
  const ageMs = now.getTime() - t
  if (ageMs < 0) return true
  return ageMs < ADMIN_ENGAGED_WINDOW_MINUTES * 60_000
}

/** 세션의 마지막 관리자 답변을 조회해 응대 중 여부를 돌려준다. 실패해도 던지지 않고 true(끼어들지 않음)로 돌려준다. */
export async function isAdminEngaged(
  admin: AdminClient,
  sessionId: string,
  adminId: string | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!adminId) return false
  try {
    const { data, error } = await admin
      .from('chat_messages')
      .select('created_at')
      .eq('session_id', sessionId)
      .eq('sender_type', 'admin')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[crazychat] 관리자 응대 여부 조회 실패(응대 중으로 간주):', error.message)
      return true
    }
    return evaluateAdminEngaged(adminId, (data as { created_at?: string } | null)?.created_at ?? null, now)
  } catch (e) {
    console.error('[crazychat] 관리자 응대 여부 조회 예외(응대 중으로 간주):', e instanceof Error ? e.message : String(e))
    return true
  }
}
