import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session || !locals.cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
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

  // 기존 open 채팅 세션 조회
  const { data: chatSession } = await admin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', contract.user_id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let sessionId: string
  if (chatSession) {
    sessionId = chatSession.id
  } else {
    // 새 채팅 세션 생성
    const { data: newSession, error: sessionErr } = await admin
      .from('chat_sessions')
      .insert({
        user_id:      contract.user_id,
        status:       'open',
        context_type: 'reservation',
        context_id:   contractId,
      })
      .select('id')
      .single()

    if (sessionErr || !newSession) {
      return json({ error: '채팅 세션 생성 실패' }, { status: 500 })
    }
    sessionId = newSession.id
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

  return json({ ok: true, signingUrl })
}
