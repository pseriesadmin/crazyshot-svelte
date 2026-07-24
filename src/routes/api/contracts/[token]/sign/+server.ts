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

  if (strokeCount !== null && strokeCount < 3) {
    return json({ error: '서명이 너무 짧습니다. 다시 서명해 주세요.' }, { status: 400 })
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
      const [, reservationResult, profileResult] = await Promise.all([
        admin
          .from('rental_reservations')
          .update({ status: 'in_use', updated_at: new Date().toISOString() })
          .eq('id', contract.reservation_id)
          .eq('status', 'shipped'),
        admin
          .from('rental_reservations')
          .select('reservation_code')
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

      const reservationCode = reservationResult.data?.reservation_code ?? null
      const fullName        = (profileResult as { data: { full_name: string } | null })?.data?.full_name ?? null

      if (signing.user_id) {
        const { data: chatSession } = await admin
          .from('chat_sessions')
          .select('id')
          .eq('user_id', signing.user_id)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

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
                action_url:   '/cms/reservation',
              },
            })
        }
      }
    }
  }

  return json({ ok: true })
}
