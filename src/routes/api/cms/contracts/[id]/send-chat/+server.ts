import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { checkIssuerSignatureRequired } from '$lib/contract-signature/issuerSignatureCheck'
import { sendPushToUser } from '$lib/server/push'
import { isContractIssueBlocked } from '$lib/utils/contractIssueGuard'

export const POST: RequestHandler = async ({ params, locals, url }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // P7-5: manager 이상만 계약서 발행·발송 허용
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  // 계약서 조회 → user_id 확인
  const { data: contract, error: contractErr } = await admin
    .from('contracts')
    .select('id, user_id, reservation_id')
    .eq('id', contractId)
    .maybeSingle()

  if (contractErr || !contract) {
    return json({ error: '계약서를 찾을 수 없습니다.' }, { status: 404 })
  }

  // 취소·만료된 예약은 발송 차단
  if (contract.reservation_id != null) {
    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', contract.reservation_id)
      .maybeSingle()

    if (isContractIssueBlocked(reservation?.status)) {
      return json({ error: '취소되었거나 만료된 예약은 계약서를 발송할 수 없습니다.' }, { status: 422 })
    }
  }

  // P8B-4: 발행자 서명 필수 플래그 강제 검증
  // SupabaseClient → unknown → CheckAdminClient 순서로 캐스팅 (제네릭 추론 폭발 방지)
  type CheckClient = Parameters<typeof checkIssuerSignatureRequired>[0]
  const sigCheck = await checkIssuerSignatureRequired(
    admin as unknown as CheckClient,
    contractId,
  )
  if (sigCheck.blocked) {
    return json({ error: sigCheck.reason ?? '발행자 서명이 필요합니다.' }, { status: 422 })
  }

  // contract_signings: 존재하면 재사용, 없으면 신규 생성
  const { data: existing } = await admin
    .from('contract_signings')
    .select('id, token, signed_at')
    .eq('contract_id', contractId)
    .maybeSingle()

  // RSV-C-B1: 이미 서명 완료된 계약서는 재발송 차단 — 서명 완료 후 재발송하면
  // 서명링크가 리셋돼 expires_at이 갱신되고, 고객이 또다시 서명 액션카드를 받아
  // 혼란을 줄 수 있다. signed_at이 있으면 발송을 막는다.
  const existingTyped = existing as { id: string; token: string; signed_at: string | null } | null
  if (existingTyped?.signed_at) {
    return json({ error: '이미 서명이 완료된 계약서는 재발송할 수 없습니다.' }, { status: 400 })
  }

  let token: string
  if (existingTyped) {
    token = existingTyped.token
    // 재발송 시 sent_at과 함께 expires_at도 "지금부터 30일"로 리셋한다.
    // Migration 146은 최초 INSERT 시 1회만 expires_at을 설정하므로, 재발송 경로에서는
    // 별도로 갱신하지 않으면 최초 발송 시각 기준 30일이 그대로 유지돼 서명 기한이 줄어든다.
    // 이 sent_at 갱신 시각이 release_reservation_hold의 D-1 타이머 리셋 기준(GREATEST 조건)으로도
    // 사용된다 — service-operations.md §10, TASK.md GATE B Q7 확정.
    const now = new Date()
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    await admin
      .from('contract_signings')
      .update({
        sent_at:    now.toISOString(),
        expires_at: expires.toISOString(),
      })
      .eq('id', existingTyped.id)
  } else {
    const { data: newSigning, error: insertErr } = await admin
      .from('contract_signings')
      .insert({
        contract_id: contractId,
        user_id:     contract.user_id,
        sent_at:     new Date().toISOString(),
      })
      .select('token')
      .single()

    if (insertErr || !newSigning) {
      return json({ error: '서명 링크 생성 실패' }, { status: 500 })
    }
    token = newSigning.token
  }

  const signingUrl = `${url.origin}/contract/${token}`

  // 채팅 세션 탐색/생성 — 공용 헬퍼로 통합(Migration 282, find_or_create_general_chat_session).
  // 과거엔 이 파일이 context_type 필터 없이(= 'general' 세션과 무관한 엉뚱한 세션과 뒤섞임)
  // 자체 pending→open→closed→신규 로직을 갖고 있었고, pending 세션을 찾아도 open으로
  // 승격시키지 않아 결함A(세션 상태 단절)와 동일한 유형의 버그를 그대로 갖고 있었다
  // (2026-08-18 실화면 검증으로 재현·확인). 알림 발송 함수들과 동일한 공용 헬퍼로 교체해
  // 세션 분산·상태단절 문제를 함께 해소한다.
  const { data: sessionId, error: sessionRpcErr } = await admin.rpc('find_or_create_general_chat_session', {
    p_user_id:         contract.user_id,
    p_reservation_id:  contract.reservation_id ?? null,
  })

  if (sessionRpcErr || !sessionId) {
    return json({ error: '채팅 세션 생성 실패' }, { status: 500 })
  }

  // 채팅 메시지 INSERT (admin 발신 action_card)
  const { error: msgErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:   sessionId,
      sender_type:  'admin',
      message_type: 'action_card',
      content:      '전자계약을 확인 후 서명을 등록해주세요.',
      action_payload: {
        type:         'contract_link',
        // 관리자 CMS 대화카드 모달이 ContractTemplatePreviewModal(viewOnly)로 고객이 보는
        // 계약서를 미리보기할 수 있도록 contract_id 포함(ActionCard.svelte 참고)
        contract_id:  contract.id,
        reservation_id: contract.reservation_id != null ? String(contract.reservation_id) : undefined,
        action_url:   signingUrl,
        button_label: '전자계약서명',
      },
    })

  if (msgErr) {
    return json({ error: '메시지 발송 실패' }, { status: 500 })
  }

  // 고객 FCM 푸시 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음, 갭#4 수정 2026-08-12)
  // 딥링크는 서명 URL 자체로 지정 — 클릭 즉시 서명 화면으로 이동
  await sendPushToUser(contract.user_id, 'contract_sent', {
    title: '전자계약이 도착했어요',
    body: '계약서를 확인하고 서명해주세요.',
    link: signingUrl,
  })

  // P8A-3: sent 이벤트 감사로그 (silent fail)
  const { session } = await locals.safeGetSession()
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId: contractId as string,
    eventType:  'sent',
    actorType:  'admin',
    actorId:    session?.user?.id ?? null,
    ipAddress:  null, // POST handler에서 getClientAddress 미사용 (기존 패턴 유지)
  })

  return json({ ok: true, signingUrl })
}
