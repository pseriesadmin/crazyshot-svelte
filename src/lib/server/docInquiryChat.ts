// 본인증명 승인 대기 안내·문의 채팅 메시지 (2026-10-05)
// - 필수 서류를 모두 등록한 직후(upload-doc)와 고객이 [문의]를 눌렀을 때(doc-inquiry) 같은 자동 안내를 상담 채팅에 남긴다.
// - 세션 조회는 반드시 find_or_create_general_chat_session RPC 경유(service-operations.md §11) — 대기/종료 세션은 이 RPC가 open으로 승격한다.
// - 같은 문구를 DEDUPE_MINUTES 안에 다시 보내지 않는다(서류를 연달아 교체·문의 연타 시 채팅이 도배되지 않게).
import type { SupabaseClient } from '@supabase/supabase-js'

export const DOC_INQUIRY_USER_MESSAGE = '본인증명 서류 승인 문의드립니다.'
export const DOC_PENDING_NOTICE =
  '관리자가 확인하는 대로 인증 승인 후 자동 안내드리겠습니다. 잠시만 기다려주세요.'
const DEDUPE_MINUTES = 60

export interface DocChatPostResult {
  sessionId: string | null
  userMessagePosted: boolean
  noticePosted: boolean
}

async function recentlyPosted(
  admin: SupabaseClient,
  sessionId: string,
  content: string,
  senderType: 'user' | 'admin',
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString()
  const { data } = await admin
    .from('chat_messages')
    .select('id')
    .eq('session_id', sessionId)
    .eq('sender_type', senderType)
    .eq('content', content)
    .gte('created_at', since)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/** 상담 세션을 찾아(없으면 생성) 문의 메시지(선택)와 승인 대기 자동 안내를 남긴다. 실패는 호출부가 fail-soft로 처리한다. */
export async function postDocPendingChat(
  admin: SupabaseClient,
  userId: string,
  opts: { withUserMessage: boolean },
): Promise<DocChatPostResult> {
  const { data: sessionId, error } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id: userId,
    p_reservation_id: null,
  })
  if (error || !sessionId) {
    throw new Error(error?.message ?? 'chat session not found')
  }
  const sid = sessionId as string
  const result: DocChatPostResult = { sessionId: sid, userMessagePosted: false, noticePosted: false }

  if (opts.withUserMessage && !(await recentlyPosted(admin, sid, DOC_INQUIRY_USER_MESSAGE, 'user'))) {
    const { error: insErr } = await admin.from('chat_messages').insert({
      session_id: sid,
      sender_type: 'user',
      message_type: 'text',
      content: DOC_INQUIRY_USER_MESSAGE,
      is_read: false,
    })
    if (insErr) throw new Error(insErr.message)
    result.userMessagePosted = true
  }

  if (!(await recentlyPosted(admin, sid, DOC_PENDING_NOTICE, 'admin'))) {
    const { error: insErr } = await admin.from('chat_messages').insert({
      session_id: sid,
      sender_type: 'admin',
      message_type: 'text',
      content: DOC_PENDING_NOTICE,
      is_read: false,
    })
    if (insErr) throw new Error(insErr.message)
    result.noticePosted = true
  }

  if (result.userMessagePosted || result.noticePosted) {
    await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sid)
  }
  return result
}
