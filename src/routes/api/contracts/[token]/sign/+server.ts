import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import { sendPushToAdmins } from '$lib/server/push'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 채팅 세션 재사용 정책 보조 — 지정된 status의 최신 세션 1건 조회 (없으면 null)
  // admin을 클로저로 참조 — 별도 함수 매개변수 타입 경계를 만들지 않아야
  // SupabaseClient 제네릭 추론이 어긋나지 않음(REFACTOR 중 svelte-check 에러 유발 확인됨)
  const findChatSessionByStatus = async (
    userId: string,
    status: 'pending' | 'open' | 'closed',
  ): Promise<string | null> => {
    const { data } = await admin
      .from('chat_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.id ?? null
  }

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

  const { error: updateErr } = await admin
    .from('contract_signings')
    .update({
      signed_at:      new Date().toISOString(),
      ip_address:     getClientAddress(),
      signature_data: signatureData,
      stroke_count:   strokeCount,
    })
    .eq('id', signing.id)
    .is('signed_at', null)

  if (updateErr) {
    return json({ error: '서명 처리에 실패했습니다.' }, { status: 500 })
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

      if (currentReservation?.status === 'shipped') {
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
        // 채팅 세션 재사용 정책: pending → open → closed(재활성화) → 신규 생성
        // (open/pending만 조회하면 세션이 전부 closed이거나 없을 때 알림이 조용히 유실됨)
        let chatSessionId = await findChatSessionByStatus(signing.user_id, 'pending')

        if (!chatSessionId) {
          chatSessionId = await findChatSessionByStatus(signing.user_id, 'open')
        }

        if (!chatSessionId) {
          const closedSessionId = await findChatSessionByStatus(signing.user_id, 'closed')
          if (closedSessionId) {
            await admin
              .from('chat_sessions')
              .update({ status: 'open', updated_at: new Date().toISOString() })
              .eq('id', closedSessionId)
            chatSessionId = closedSessionId
          }
        }

        if (!chatSessionId) {
          const { data: newSession } = await admin
            .from('chat_sessions')
            .insert({
              user_id:      signing.user_id,
              status:       'open',
              context_type: 'reservation',
            })
            .select('id')
            .single()
          chatSessionId = newSession?.id ?? null
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
