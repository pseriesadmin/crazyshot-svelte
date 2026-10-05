// POST /api/profile/doc-inquiry — 본인증명 "승인 대기" 상태의 고객이 [문의]를 눌렀을 때 (2026-10-05)
// 서버가 고객 문의 메시지와 자동 안내를 상담 채팅에 남기고, 관리자에게 푸시(identity_review 플래그 재사용)를 보낸다.
// 고객 화면은 응답 후 상담톡(openChat)을 열기만 하면 된다 — 입력창 사전문구 없이 원클릭으로 끝난다.
// 승인 대기(pending) 상태일 때만 동작한다(미등록·승인 완료 상태로는 문의 메시지를 만들지 않는다).
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getDocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { postDocPendingChat } from '$lib/server/docInquiryChat'
import { sendPushToAdmins } from '$lib/server/push'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: profile } = await admin
    .from('user_profiles')
    .select(
      'full_name, identity_doc_url, identity_type, identity_verified_at, identity_approved_at, ' +
        'foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at',
    )
    .eq('user_id', session.user.id)
    .maybeSingle()

  const gate = getDocGateStatus(profile as DocGateRow | null)
  if (gate !== 'pending') {
    // 승인 전 문의는 필수 서류를 모두 등록한 뒤에만 의미가 있다 — 그 외 상태는 상담톡만 열면 되므로 메시지는 만들지 않는다.
    return json({ ok: true, posted: false, status: gate })
  }

  try {
    const result = await postDocPendingChat(admin, session.user.id, { withUserMessage: true })
    if (result.userMessagePosted) {
      const displayName = (profile as { full_name?: string } | null)?.full_name || '고객'
      await sendPushToAdmins('identity_review', {
        title: '본인증명 승인 문의',
        body: `'${displayName}' 회원이 본인증명 승인을 문의했어요.`,
        link: result.sessionId ? `/cms/chat?session=${result.sessionId}` : `/cms/customers?selected=${session.user.id}`,
      })
    }
    return json({ ok: true, posted: result.userMessagePosted || result.noticePosted, status: gate })
  } catch (e) {
    console.error('[doc-inquiry] 문의 메시지 발송 실패:', e instanceof Error ? e.message : e)
    return json({ ok: false, error: '문의를 접수하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
}
