import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import { sendPushToAdmins, sendPushToUser } from '$lib/server/push'
import { computeContentHash } from '$lib/contract-signature/contentHash'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: signing, error: findErr } = await admin
    .from('contract_signings')
    .select('id, signed_at, expires_at, contract_id, user_id')
    .eq('token', params.token)
    .maybeSingle()

  if (findErr || !signing) {
    return json({ error: '유효하지 않은 서명 링크입니다.' }, { status: 404 })
  }

  if (signing.signed_at) {
    return json({ error: '이미 서명된 계약서입니다.' }, { status: 409 })
  }

  if (signing.expires_at && new Date(signing.expires_at) < new Date()) {
    return json({ error: '서명 링크가 만료되었습니다. 업체에 재발송을 요청해 주세요.' }, { status: 410 })
  }

  let signatureData: string | null = null
  let strokeCount: number | null   = null

  const body = await request.json().catch(() => null)
  if (body) {
    signatureData = typeof body.signature_data === 'string' ? body.signature_data : null
    strokeCount   = typeof body.stroke_count   === 'number' ? body.stroke_count   : null
  }

  // 클라이언트(SignatureCanvas)와 동일 기준 — 1회라도 그렸으면 유효, 다회 스트로크 요구 없음
  if (strokeCount !== null && strokeCount < 1) {
    return json({ error: '서명이 등록되지 않았습니다. 다시 서명해 주세요.' }, { status: 400 })
  }

  // P8A-1 + 2026-08-21 스냅샷 도입: 서명 시점 콘텐츠를 통째로 얼려 signed_content_snapshot에
  // 저장하고, 그 스냅샷 객체 전체를 해시 대상으로 삼는다. 예전에는 canvas_document ??
  // content_blocks만 해시해 스프레드시트 모드(content_blocks가 항상 []로 저장됨)의 해시가
  // 실제 내용과 무관하게 고정되던 결함이 있었음 — 스냅샷 도입으로 함께 해소.
  let contentHash: string | null = null
  let signedContentSnapshot: Record<string, unknown> | null = null
  if (signing.contract_id) {
    const { data: contractContent } = await admin
      .from('contracts')
      .select('title, authoring_mode, content_blocks, specifications, canvas_document, spreadsheet_document')
      .eq('id', signing.contract_id)
      .maybeSingle()
    if (contractContent) {
      signedContentSnapshot = contractContent
      contentHash = await computeContentHash(contractContent)
    }
  }

  const clientIp = getClientAddress()
  const { error: updateErr } = await admin
    .from('contract_signings')
    .update({
      signed_at:               new Date().toISOString(),
      ip_address:              clientIp,
      signature_data:          signatureData,
      stroke_count:            strokeCount,
      content_hash:            contentHash,             // P8A-1: 서명 시점 콘텐츠 해시
      signed_content_snapshot: signedContentSnapshot,    // 서명 시점 콘텐츠 스냅샷(형태 보존)
    })
    .eq('id', signing.id)
    .is('signed_at', null)

  if (updateErr) {
    return json({ error: '서명 처리에 실패했습니다.' }, { status: 500 })
  }

  // P8A-3: 감사로그 — signed 이벤트 기록 (silent fail — 주 흐름 차단 금지)
  if (signing.contract_id) {
    await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId: signing.contract_id,
      eventType:  'signed',
      actorType:  'customer',
      actorId:    signing.user_id ?? null,
      ipAddress:  clientIp,
    })
  }

  if (signing.contract_id) {
    const { data: contract } = await admin
      .from('contracts')
      .select('reservation_id')
      .eq('id', signing.contract_id)
      .maybeSingle()

    if (contract?.reservation_id) {
      // H-01: 예약 상태 변경은 반드시 RPC 경유. update_reservation_status RPC는 이전 상태
      // 가드가 없으므로, 직접 DML이 갖고 있던 .eq('status','shipped') 가드를 보존하기 위해
      // RPC 호출 전 현재 상태를 먼저 조회해 shipped일 때만 in_use로 전환한다.
      const { data: currentReservation } = await admin
        .from('rental_reservations')
        .select('status')
        .eq('id', contract.reservation_id)
        .maybeSingle()

      // 계약서 서명 완료 게이팅(Migration 284): hold 상태 예약은 결제완료(payment_confirmed_at)
      // 까지 이미 충족돼 있어야만 이 시점에 confirmed로 전환된다(try_confirm_reservation이
      // AND 조건을 다시 검증) — 결제가 아직이면 hold 그대로 유지되고 관리자가 결제 확인 후
      // 별도 트리거(mark_reservation_payment_confirmed)로 재시도된다.
      // 2026-08-31(Migration 397): 계약이 이제 주문당 1건만 존재해(init-contract 정책)
      // 이 계약을 직접 소유하지 않은 형제 예약(같은 주문의 다른 상품)은 이 대표 예약만
      // 재시도해서는 영원히 hold에 갇힌다 — try_confirm_reservation_order로 같은 주문
      // 전체를 함께 재시도한다(단일 예약 주문이면 자기 자신만 처리해 무회귀).
      if (currentReservation?.status === 'hold') {
        const { data: justConfirmedIds, error: confirmOrderErr } = await admin.rpc('try_confirm_reservation_order', {
          p_reservation_id: contract.reservation_id,
        })
        if (confirmOrderErr) {
          // 서명 자체는 위에서 이미 정상 저장됨(signed_at) — 이 RPC 실패는 confirmed 자동전환
          // 시도가 조용히 안 됐다는 뜻이라, 로그로 남겨야 나중에 "결제+서명 다 됐는데 왜
          // hold에 머물러 있나"를 추적할 수 있다(try_confirm_reservation_order는 멱등이라
          // 이후 다른 트리거로 재시도돼도 안전).
          console.error('[contracts/sign] try_confirm_reservation_order 실패:', confirmOrderErr.message, { reservationId: contract.reservation_id })
        }
        if (((justConfirmedIds ?? []) as number[]).length > 0) {
          // 채팅 알림 + 고객 푸시 — 공용 헬퍼로 통합 (NTF-C2/NTF-C3 수정, 2026-08-31)
          // mode='hold' 시 채팅·푸시 둘 다 보류. 기존에는 채팅만 있고 reservation_approval
          // 푸시 호출이 완전히 없어 서명완료 자동승인 시 고객이 푸시를 받지 못하던 NTF-C3
          // 공백을 이 헬퍼 적용으로 해소한다 — service-operations.md §4/§15
          const notifyPlan = await resolveApprovalNotifyPlan(admin, contract.reservation_id)
          await sendApprovalNotifications(admin, contract.reservation_id, notifyPlan)
        }
      } else if (currentReservation?.status === 'shipped') {
        await admin.rpc('update_reservation_status', {
          p_reservation_id: contract.reservation_id,
          p_new_status:     'in_use',
        })
      }

      const [reservationResult, profileResult] = await Promise.all([
        admin
          .from('rental_reservations')
          .select('reservation_code, status')
          .eq('id', contract.reservation_id)
          .maybeSingle(),
        signing.user_id
          ? admin
              .from('user_profiles')
              .select('full_name')
              .eq('id', signing.user_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const reservationCode   = reservationResult.data?.reservation_code ?? null
      const reservationStatus = reservationResult.data?.status ?? null
      const fullName          = (profileResult as { data: { full_name: string } | null })?.data?.full_name ?? null

      // confirmed 이후 상태(대여 라이프사이클)는 /cms/rentals, 그 이전(hold/pending/cancelled)은 /cms/reservation에서 관리
      // (rental-lifecycle.md RENTAL_STATUSES 기준과 동일)
      const RENTAL_STATUSES = new Set(['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed'])
      const cmsPath = reservationStatus && RENTAL_STATUSES.has(reservationStatus) ? '/cms/rentals' : '/cms/reservation'

      if (signing.user_id) {
        // 채팅 세션 탐색/생성 — 공용 헬퍼로 통합(Migration 282, find_or_create_general_chat_session).
        // 과거엔 이 파일 자체 pending→open→closed→신규 로직(context_type 필터 없음)이
        // send_rental_chat_notification 계열이 쓰는 'general' 세션과 무관한 엉뚱한 세션을
        // 찾아버렸고, pending 세션을 찾아도 open으로 승격하지 않았다 — 그 결과 같은 서명
        // 이벤트의 reservation_approval(위 RPC 경유, 정상)과 contract_signed(이 블록,
        // 비정상) 두 알림이 서로 다른 세션으로 쪼개지는 문제가 있었다(2026-08-18 실화면
        // 검증으로 재현·확인).
        const { data: chatSessionId, error: signChatErr } = await admin.rpc('find_or_create_general_chat_session', {
          p_user_id:        signing.user_id,
          p_reservation_id: contract.reservation_id,
        })
        if (signChatErr) {
          console.error('[contracts/sign] find_or_create_general_chat_session 실패(fail-soft):', signChatErr.message)
        }

        if (chatSessionId) {
          const content = fullName
            ? `${fullName} 고객님의 전자계약 서명이 완료되었습니다.`
            : '전자계약 서명이 완료되었습니다.'

          await admin
            .from('chat_messages')
            .insert({
              session_id:   chatSessionId,
              sender_type:  'admin',
              message_type: 'action_card',
              content,
              action_payload: {
                type:         'contract_signed',
                reservation_id: contract.reservation_id != null ? String(contract.reservation_id) : undefined,
                reservation_no: reservationCode ?? undefined,
                button_label: '전자계약완료',
                action_url:   `/account/rental/${contract.reservation_id}/contract`,
              },
            })

          // 고객 브라우저 푸시 (2026-08-19 전역감사로 발견된 공백 보완, service-operations.md §15)
          // — 관리자용 sendPushToAdmins('contract_signed', ...)와는 별개로 고객 본인에게도 발송
          await sendPushToUser(signing.user_id, 'contract_signed_customer', {
            title: '전자계약 서명이 완료됐어요',
            body: reservationCode ? `${reservationCode} 예약의 서명이 정상 접수됐어요.` : '서명이 정상적으로 접수됐어요.',
            link: '/account/rental',
          })
        }
      }

      // 전자서명 완료 관리자 푸시 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
      await sendPushToAdmins('contract_signed', {
        title: '전자계약 서명이 완료됐어요',
        body: `${fullName ? `${fullName}님이 ` : ''}${reservationCode ? `${reservationCode} ` : ''}계약서에 서명했어요.`,
        link: `${cmsPath}?selected=${contract.reservation_id}`,
      })
    }
  }

  return json({ ok: true })
}
