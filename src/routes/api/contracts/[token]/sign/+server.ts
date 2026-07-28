import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
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
      // 상태 갱신을 먼저 확정한 뒤 조회해야 아래 RENTAL_STATUSES 판정이 최신 상태를 반영함
      await admin
        .from('rental_reservations')
        .update({ status: 'in_use', updated_at: new Date().toISOString() })
        .eq('id', contract.reservation_id)
        .eq('status', 'shipped')

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
        // pending 세션 우선 (관리자 대화 중인 세션) → open 세션 폴백
        const { data: pendingSession } = await admin
          .from('chat_sessions')
          .select('id')
          .eq('user_id', signing.user_id)
          .eq('status', 'pending')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        let chatSession = pendingSession
        if (!chatSession) {
          const { data: openSession } = await admin
            .from('chat_sessions')
            .select('id')
            .eq('user_id', signing.user_id)
            .eq('status', 'open')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          chatSession = openSession
        }

        if (chatSession) {
          const content = fullName
            ? `${fullName} 고객님의 전자계약 서명이 완료되었습니다.`
            : '전자계약 서명이 완료되었습니다.'

          await admin
            .from('chat_messages')
            .insert({
              session_id:   chatSession.id,
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
    }
  }

  return json({ ok: true })
}
