/**
 * POST /api/cms/contracts/[id]/share-chat
 *
 * 이미 서명 완료된 계약서를 "신규 발행/재발송"이 아니라 완료된 계약정보를 채팅으로
 * 단순 재공유한다(2026-09-08 Stephen 지시).
 *
 * send-chat(/api/cms/contracts/[id]/send-chat)은 서명 완료된 계약을 재발송 불가로
 * 명시적으로 차단한다(RSV-C-B1 — 서명 완료 후 재발송하면 서명링크가 리셋돼 혼란을 줄 수
 * 있음). 이 엔드포인트는 그 차단을 우회하지 않고, 애초에 다른 목적(공유)을 위한 완전히
 * 별도의 가벼운 경로다 — contract_signings.sent_at/expires_at은 전혀 건드리지 않고
 * (서명 요청 상태가 아니므로), sign/+server.ts가 서명 완료 시점에 자동 발송하는
 * contract_signed 카드와 동일한 payload를 재사용해 "전자계약완료" 카드를 다시 보낸다.
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

export const POST: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // send-chat과 동일 권한 기준(manager 이상) — security-auth.md 접근 매트릭스 참조
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  const { data: contract, error: contractErr } = await admin
    .from('contracts')
    .select('id, user_id, reservation_id')
    .eq('id', contractId)
    .maybeSingle()

  if (contractErr || !contract) {
    return json({ error: '계약서를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (!contract.user_id) {
    return json({ error: '고객 정보를 찾을 수 없습니다.' }, { status: 400 })
  }

  // 이 경로는 "서명 완료된 계약"만 대상 — 미서명 초안은 send-chat(발송) 전용 경로를 써야 함
  const { data: signing } = await admin
    .from('contract_signings')
    .select('signed_at')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (!signing?.signed_at) {
    return json({ error: '서명 완료된 계약서만 공유할 수 있습니다.' }, { status: 400 })
  }

  // 채팅 세션 탐색/생성 — 공용 헬퍼로 통합(service-operations.md §11 원칙 준수,
  // find_or_create_general_chat_session 재사용 — 자체 세션조회 재구현 금지)
  const { data: sessionId, error: sessionRpcErr } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id:        contract.user_id,
    p_reservation_id: contract.reservation_id ?? null,
  })

  if (sessionRpcErr || !sessionId) {
    return json({ error: '채팅 세션 생성 실패' }, { status: 500 })
  }

  const { error: msgErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:   sessionId,
      sender_type:  'admin',
      message_type: 'action_card',
      content:      '완료된 전자계약서를 다시 공유해드립니다.',
      action_payload: {
        type:            'contract_signed',
        contract_id:     contract.id,
        reservation_id:  contract.reservation_id != null ? String(contract.reservation_id) : undefined,
        button_label:    '전자계약완료',
        action_url:      `/account/rental/${contract.reservation_id}/contract`,
      },
    })

  if (msgErr) {
    return json({ error: '메시지 발송 실패' }, { status: 500 })
  }

  return json({ ok: true })
}
