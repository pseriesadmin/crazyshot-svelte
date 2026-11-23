// src/lib/server/unansweredNotice.ts
// '문의 후 30분간 답변 없음' 안내의 대화창 메시지 (2026-11-16, Stephen 지시)
// 푸시(chat_unanswered)와 같은 안내문장을 고객 대화창에도 자동응답 메시지로 남긴다 — 푸시알림 설정에 등록한 문장이 있으면 그 문장, 없으면 푸시 기본 문구.
//  · 푸시알림 설정에서 이 알림을 끈 상태(push_enabled=false)면 대화창 메시지도 보내지 않는다(알림 전체 스위치로 본다).
//  · 대상 세션은 get_and_mark_unanswered_sessions 가 방금 표시(unanswered_notified_at)한 세션뿐이다 — 같은 세션에 두 번 보내지 않는다.
//  · 어떤 오류도 던지지 않는다(세션 목록 응답과 푸시 발송을 막지 않음).
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCustomerNameVars, resolveCardContent } from '$lib/server/cardMessage'

export const UNANSWERED_DEFAULT_MESSAGE = '문의하신 내용에 아직 답변이 없어요. 잠시 후 다시 확인해 주세요.'

export async function postUnansweredChatNotice(admin: SupabaseClient, userId: string, markedSince: string): Promise<void> {
  try {
    const { data: cfg } = await admin.from('push_notification_config').select('push_enabled').eq('notify_type', 'chat_unanswered').maybeSingle()
    if ((cfg as { push_enabled?: boolean } | null)?.push_enabled === false) return

    const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId).gte('unanswered_notified_at', markedSince)
    const ids = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
    if (ids.length === 0) return

    const content = await resolveCardContent(admin, 'chat_unanswered', await loadCustomerNameVars(admin, userId), UNANSWERED_DEFAULT_MESSAGE)
    for (const id of ids) {
      const { error } = await admin.from('chat_messages').insert({ session_id: id, sender_type: 'ai', content, message_type: 'text' })
      if (!error) await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', id)
    }
  } catch {
    /* 대화창 안내 실패는 푸시·목록 응답에 영향 없음 */
  }
}
