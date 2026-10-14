import type { SupabaseClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'
import { env } from '$env/dynamic/private'
import { classifyDelivery, matchSolapiMessage, NOTIFY_TYPE_LABEL, type SmsLogLite, type SolapiMsgLite } from '$lib/utils/smsDelivery'
import { sendSmsUndeliveredAdminPush } from '$lib/server/push'

// 문자 미도착 자동 점검(2026-10-14, Stephen 확정) — 10분 크론(locker-guide)이 끝에서 호출한다.
// 점검 대상은 "계약서 안내·예약 승인"처럼 미도착이 곧 고객 이탈·예약 만료로 이어지는 유형으로 한정한다(나머지는 예약 상세 '알림발송' 탭에서 확인).
// 최근 3시간 안의 미확인 발송 로그가 없으면 DB 조회 한 번으로 끝나 솔라피를 호출하지 않는다(비용 최소화).
export const ALERT_NOTIFY_TYPES = ['contract_link', 'reservation_approval'] as const
const WINDOW_HOURS = 3
const MAX_LOGS = 100

interface CheckLog extends SmsLogLite {
  reservation_id: number
  user_id: string
}

export interface SmsAlertResult {
  checked: number
  confirmed: number
  alerted: number
  skipped?: 'no_target' | 'no_solapi_key'
  errors: string[]
}

export type AlertVerdict = 'confirm' | 'alert' | 'wait'

/** 한 건의 판정 — 수신 완료는 확인 처리, 미도착 의심·실패는 알림, 나머지는 다음 점검까지 대기 */
export function judgeLog(statusCode: string | null | undefined, sentAt: Date, now: Date): AlertVerdict {
  const state = classifyDelivery(statusCode, sentAt, now)
  if (state === 'delivered') return 'confirm'
  if (state === 'undelivered' || state === 'failed') return 'alert'
  return 'wait'
}

export async function checkUndeliveredSms(admin: SupabaseClient, now: Date = new Date()): Promise<SmsAlertResult> {
  const result: SmsAlertResult = { checked: 0, confirmed: 0, alerted: 0, errors: [] }
  const since = new Date(now.getTime() - WINDOW_HOURS * 3600 * 1000).toISOString()

  const { data: rows, error } = await admin
    .from('sms_notification_logs')
    .select('id, reservation_id, user_id, notify_type, status, error_message, created_at')
    .eq('status', 'sent')
    .in('notify_type', [...ALERT_NOTIFY_TYPES])
    .is('delivery_confirmed_at', null)
    .is('delivery_alerted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MAX_LOGS)
  if (error) { result.errors.push(`로그 조회 실패: ${error.message}`); return result }
  const logs = (rows ?? []) as CheckLog[]
  if (logs.length === 0) { result.skipped = 'no_target'; return result }

  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET) { result.skipped = 'no_solapi_key'; return result }
  const service = new SolapiMessageService(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET)

  const userIds = [...new Set(logs.map((l) => l.user_id))]
  const { data: profiles } = await admin.from('user_profiles').select('id, phone').in('id', userIds)
  const phoneByUser = new Map<string, string>()
  for (const p of (profiles ?? []) as Array<{ id: string; phone: string | null }>) {
    const digits = (p.phone ?? '').replace(/[^0-9]/g, '')
    if (digits) phoneByUser.set(p.id, digits)
  }

  const confirmIds: number[] = []
  const alertLogs: CheckLog[] = []

  for (const userId of userIds) {
    const phone = phoneByUser.get(userId)
    const userLogs = logs.filter((l) => l.user_id === userId)
    if (!phone) continue
    result.checked += userLogs.length
    let messages: SolapiMsgLite[]
    try {
      const oldest = userLogs[0].created_at // created_at 오름차순 정렬
      const res = await service.getMessages({ to: phone, startDate: new Date(new Date(oldest).getTime() - 3600 * 1000), endDate: now, limit: 100 })
      messages = Object.values(res.messageList ?? {}).map((m) => ({
        messageId: m.messageId ?? null, type: m.type ?? null, statusCode: m.statusCode ?? null, reason: m.reason ?? null,
        dateCreated: m.dateCreated ?? null, customFields: (m.customFields ?? null) as Record<string, string> | null,
      }))
    } catch (e) {
      result.errors.push(`솔라피 조회 실패: ${e instanceof Error ? e.message.replace(/\d{7,}/g, '***') : 'unknown'}`)
      continue
    }
    const used = new Set<string>()
    for (const log of userLogs) {
      const m = matchSolapiMessage(log, log.reservation_id, messages, used)
      if (!m) continue // 짝을 못 찾으면 판단하지 않는다(오탐 방지) — 3시간 창이 지나면 점검 대상에서 빠진다
      const verdict = judgeLog(m.statusCode, new Date(log.created_at), now)
      if (verdict === 'confirm') confirmIds.push(log.id)
      else if (verdict === 'alert') alertLogs.push(log)
    }
  }

  if (confirmIds.length > 0) {
    const { error: cErr } = await admin.from('sms_notification_logs').update({ delivery_confirmed_at: now.toISOString() }).in('id', confirmIds)
    if (cErr) result.errors.push(`확인 표시 실패: ${cErr.message}`)
    else result.confirmed = confirmIds.length
  }

  if (alertLogs.length > 0) {
    // 알림 표시를 먼저 남기고(조건부 UPDATE — 다른 실행이 이미 처리한 건은 제외) 표시된 건만 푸시한다 → 같은 건은 최대 1회
    const { data: marked, error: aErr } = await admin
      .from('sms_notification_logs')
      .update({ delivery_alerted_at: now.toISOString() })
      .in('id', alertLogs.map((l) => l.id))
      .is('delivery_alerted_at', null)
      .select('id, reservation_id, notify_type')
    if (aErr) { result.errors.push(`알림 표시 실패: ${aErr.message}`); return result }
    const targets = (marked ?? []) as Array<{ id: number; reservation_id: number; notify_type: string }>
    if (targets.length > 0) {
      const ids = [...new Set(targets.map((t) => t.reservation_id))]
      const { data: resv } = await admin.from('rental_reservations').select('id, reservation_code').in('id', ids)
      const codeById = new Map<number, string>(((resv ?? []) as Array<{ id: number; reservation_code: string | null }>).map((r) => [r.id, r.reservation_code ?? String(r.id)]))
      await sendSmsUndeliveredAdminPush(targets.map((t) => ({
        reservationId: t.reservation_id,
        reservationCode: codeById.get(t.reservation_id) ?? String(t.reservation_id),
        label: NOTIFY_TYPE_LABEL[t.notify_type] ?? t.notify_type,
      })))
      result.alerted = targets.length
    }
  }
  return result
}
