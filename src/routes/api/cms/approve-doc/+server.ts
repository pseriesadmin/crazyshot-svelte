// POST /api/cms/approve-doc
// 관리자가 CMS 고객상세패널(CustomerDetailPanel.svelte)의 "승인" 버튼으로 본인증명/
// 외국인증명 서류를 승인 처리(Stephen 2026-09-23 요청, Migration #526).
// body: { user_id: string, type: 'identity' | 'foreign' }
//
// 흐름: 권한게이트(manager+) → approve_customer_doc RPC → 성공 시 고객 채팅에 승인완료
// 카드 발송(find_or_create_general_chat_session 경유, service-operations.md §11) + 푸시.
//
// 이 row는 CMS 패널의 <form action="?/updateCustomerInfo">(본인증명·외국인증명 행을
// 감싸는 폼) 내부에 있어 중첩 <form>을 쓸 수 없다 — 기존 "재등록" 버튼(/api/cms/upload-doc)과
// 동일하게 SvelteKit form action이 아니라 REST 엔드포인트 + 클라이언트 fetch()로 구현.
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { sendPushToUser } from '$lib/server/push'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const userId = String((body as { user_id?: string } | null)?.user_id ?? '').trim()
  const type = (body as { type?: string } | null)?.type === 'foreign' ? 'foreign' : 'identity'

  if (!userId) return json({ ok: false, error: '사용자 ID 필수' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: rpcData, error: rpcError } = await admin.rpc('approve_customer_doc', {
    p_user_id: userId,
    p_doc_type: type,
  })
  const result = rpcData as { ok: boolean; error?: string; approved_at?: string } | null

  if (rpcError || !result?.ok) {
    console.error('[cms/approve-doc] rpc error:', rpcError?.message ?? result?.error)
    return json({ ok: false, error: result?.error ?? '승인 처리에 실패했습니다.' }, { status: 400 })
  }

  // 고객 승인완료 알림카드 + 푸시 — fail-soft(승인 자체는 이미 커밋됨)
  try {
    const { data: chatSessionId, error: sessionErr } = await admin.rpc(
      'find_or_create_general_chat_session',
      { p_user_id: userId, p_reservation_id: null },
    )
    if (sessionErr) {
      console.error('[cms/approve-doc] find_or_create_general_chat_session 실패(fail-soft):', sessionErr.message)
    } else if (chatSessionId) {
      await admin.from('chat_messages').insert({
        session_id:     chatSessionId,
        sender_type:    'admin',
        message_type:   'action_card',
        content:        '고객님 본인증명이 확인되었어요.',
        action_payload: {
          type:          'identity_approved',
          doc_type:      type,
          button_label:  '내 정보 확인하기',
          action_url:    '/account/profile?tab=profile',
        },
        is_read: false,
      })
      await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', chatSessionId)
      await sendPushToUser(userId, 'identity_approved', {
        title: '본인증명이 확인됐어요',
        body:  '본인증명정보가 정상적으로 확인됐어요.',
        link:  '/account/profile?tab=profile',
      })
    }
  } catch (e) {
    console.error('[cms/approve-doc] identity_approved 카드 발송 실패(fail-soft):', e instanceof Error ? e.message : e)
  }

  return json({ ok: true, approved_at: result.approved_at })
}
