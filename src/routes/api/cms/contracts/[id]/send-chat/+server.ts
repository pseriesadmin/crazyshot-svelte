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
    .select('id, token')
    .eq('contract_id', contractId)
    .maybeSingle()

  let token: string
  if (existing) {
    token = existing.token
    await admin
      .from('contract_signings')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', existing.id)
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

  // 1) pending 세션 우선 (관리자 핸드오프 중인 실제 대화 세션)
  //    open/pending 혼합 정렬 시 나중에 생성된 open(상품탐색) 세션이 pending(대화 중) 세션보다
  //    updated_at이 더 최신이 되어 잘못된 세션을 선택하는 문제 방지
  const { data: pendingSession } = await admin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', contract.user_id)
    .eq('status', 'pending')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let sessionId: string
  if (pendingSession) {
    sessionId = pendingSession.id
  } else {
    // 2) open 세션 조회
    const { data: openSession } = await admin
      .from('chat_sessions')
      .select('id')
      .eq('user_id', contract.user_id)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (openSession) {
      sessionId = openSession.id
    } else {
      // 3) closed 세션 재활성화 시도
      const { data: closedSession } = await admin
        .from('chat_sessions')
        .select('id')
        .eq('user_id', contract.user_id)
        .eq('status', 'closed')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (closedSession) {
        await admin
          .from('chat_sessions')
          .update({ status: 'open', updated_at: new Date().toISOString() })
          .eq('id', closedSession.id)
        sessionId = closedSession.id
      } else {
        // 4) 세션 없음 → 신규 생성 (context_id는 uuid 컬럼이므로 미설정)
        const { data: newSession, error: sessionErr } = await admin
          .from('chat_sessions')
          .insert({
            user_id:      contract.user_id,
            status:       'open',
            context_type: 'reservation',
          })
          .select('id')
          .single()

        if (sessionErr || !newSession) {
          return json({ error: '채팅 세션 생성 실패' }, { status: 500 })
        }
        sessionId = newSession.id
      }
    }
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
        action_url:   signingUrl,
        button_label: '전자계약 보기',
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
