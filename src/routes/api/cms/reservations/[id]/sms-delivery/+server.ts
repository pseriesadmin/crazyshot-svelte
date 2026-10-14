import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { buildDeliveryCards, type SmsLogLite, type SolapiMsgLite } from '$lib/utils/smsDelivery'
import type { RequestHandler } from './$types'

// 예약 상세 "알림발송" 탭 — 이 예약으로 나간 SMS 발송 내역(sms_notification_logs)과 솔라피의 단말 도착 결과(상태코드)를 한 목록으로 돌려준다.
// 조회 전용. 솔라피는 "수신번호 + 기간"으로 메시지를 조회할 수 있어(2026-10-14 실측) 저장된 메시지 ID가 없는 옛 발송분도 시각으로 짝지어 보여준다.
// 휴대폰 번호는 응답에 마지막 4자리만 싣는다.
export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: reservation, error: rErr } = await admin
    .from('rental_reservations')
    .select('id, user_id')
    .eq('id', reservationId)
    .maybeSingle()
  if (rErr) return json({ error: rErr.message }, { status: 500 })
  if (!reservation) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const { data: logRows, error: lErr } = await admin
    .from('sms_notification_logs')
    .select('id, notify_type, status, error_message, created_at')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (lErr) return json({ error: lErr.message }, { status: 500 })
  const logs = (logRows ?? []) as SmsLogLite[]

  const { data: profile } = await admin
    .from('user_profiles')
    .select('phone')
    .eq('id', reservation.user_id as string)
    .maybeSingle()
  const phoneDigits = ((profile as { phone?: string | null } | null)?.phone ?? '').replace(/[^0-9]/g, '')
  const phoneMasked = phoneDigits.length >= 8 ? `${phoneDigits.slice(0, 3)}-****-${phoneDigits.slice(-4)}` : null

  if (logs.length === 0) {
    return json({ phone_masked: phoneMasked, cards: [], solapi_checked: false, solapi_error: null })
  }

  // 솔라피 조회 — 실패해도 발송 내역은 보여준다(결과만 "확인 불가")
  let messages: SolapiMsgLite[] = []
  let solapiError: string | null = null
  let solapiChecked = false
  if (!phoneDigits) {
    solapiError = '고객 휴대폰 번호가 없어 솔라피 결과를 조회하지 못했습니다.'
  } else if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET) {
    solapiError = '솔라피 키가 설정되지 않아 결과를 조회하지 못했습니다.'
  } else {
    try {
      const oldest = logs.reduce((min, l) => (l.created_at < min ? l.created_at : min), logs[0].created_at)
      const startDate = new Date(new Date(oldest).getTime() - 60 * 60 * 1000)
      const service = new SolapiMessageService(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET)
      const res = await service.getMessages({ to: phoneDigits, startDate, endDate: new Date(), limit: 100 })
      messages = Object.values(res.messageList ?? {}).map((m) => ({
        messageId: m.messageId ?? null,
        type: m.type ?? null,
        statusCode: m.statusCode ?? null,
        reason: m.reason ?? null,
        dateCreated: m.dateCreated ?? null,
        customFields: (m.customFields ?? null) as Record<string, string> | null,
      }))
      solapiChecked = true
    } catch (e) {
      solapiError = '솔라피 결과 조회에 실패했습니다.'
      console.error('[sms-delivery] 솔라피 조회 실패:', reservationId, e instanceof Error ? e.message.replace(/\d{7,}/g, '***') : 'unknown')
    }
  }

  const cards = buildDeliveryCards(logs, reservationId, messages)
  return json({ phone_masked: phoneMasked, cards, solapi_checked: solapiChecked, solapi_error: solapiError })
}
