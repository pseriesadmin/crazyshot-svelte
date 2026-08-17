import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import { sendPushToAdmins } from '$lib/server/push'
import { computeContentHash } from '$lib/contract-signature/contentHash'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
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

  // P8A-1: 서명 대상 콘텐츠 해시 계산 — contracts.content_blocks(또는 canvas_document)를 조회해 SHA-256 계산
  // 서명 시점의 문서 상태를 암호학적으로 고정 (위변조 사후 검증 가능)
  let contentHash: string | null = null
  if (signing.contract_id) {
    const { data: contractContent } = await admin
      .from('contracts')
      .select('content_blocks, canvas_document')
      .eq('id', signing.contract_id)
      .maybeSingle()
    if (contractContent) {
      // canvas_document가 있으면 canvas 모드, 없으면 content_blocks를 해시 대상으로 사용
      const hashTarget = contractContent.canvas_document ?? contractContent.content_blocks
      contentHash = await computeContentHash(hashTarget)
    }
  }

  const clientIp = getClientAddress()
  const { error: updateErr } = await admin
    .from('contract_signings')
    .update({
      signed_at:      new Date().toISOString(),
      ip_address:     clientIp,
      signature_data: signatureData,
      stroke_count:   strokeCount,
      content_hash:   contentHash,  // P8A-1: 서명 시점 콘텐츠 해시
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
      if (currentReservation?.status === 'hold') {
        const { data: justConfirmed } = await admin.rpc('try_confirm_reservation', {
          p_reservation_id: contract.reservation_id,
        })
        if (justConfirmed === true) {
          // 같은 주문(order_items)으로 묶인 다중상품 예약이면 관리자 수동승인
          // (approveReservation)과 동일하게 통합 카드로 안내 — service-operations.md §4
          // 정책을 승인 트리거(관리자 수동 vs 고객 서명완료 자동)와 무관하게 일치시킴
          // (reservation-rental-execution.md §0-4 #7 — 이전엔 이 경로만 항상 단건 발송이라
          // 묶음주문도 상품별로 개별 카드가 여러 건 나가던 설계공백이었음)
          const notifyPlan = await resolveApprovalNotifyPlan(admin, contract.reservation_id)
          if (notifyPlan.mode === 'batch') {
            await admin.rpc('send_rental_chat_notification_batch', {
              p_reservation_ids: notifyPlan.reservationIds,
              p_notify_type:     'reservation_approval',
            })
          } else if (notifyPlan.mode === 'single') {
            await admin.rpc('send_rental_chat_notification', {
              p_reservation_id: contract.reservation_id,
              p_notify_type:    'reservation_approval',
            })
          }
          // notifyPlan.mode === 'hold' → 같은 주문의 다른 상품이 아직 미승인 — 알림 보류
          // (마지막 상품이 confirmed되는 시점에 위 batch 분기가 통합 카드로 한 번에 발송)
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
        const { data: chatSessionId } = await admin.rpc('find_or_create_general_chat_session', {
          p_user_id:        signing.user_id,
          p_reservation_id: contract.reservation_id,
        })

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
                reservation_no: reservationCode ?? undefined,
                button_label: '전자계약 확인',
                action_url:   `${cmsPath}?selected=${contract.reservation_id}`,
              },
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
