// 솔라피 발송 결과(상태코드) 해석 + 우리 발송 로그(sms_notification_logs) ↔ 솔라피 메시지 매칭 (2026-10-14)
// 솔라피 상태코드: 2000 발송 대기 · 3000 이통사 접수(결과 리포트 대기) · 4000 수신 완료 · 그 외 = 실패 사유 코드.
// "3000에서 오래 멈춤" = 이통사가 접수만 하고 단말 도착 리포트를 주지 않은 상태(수신 회선·LMS 경로 문제 가능) → 미도착 의심.

export type SmsDeliveryState = 'delivered' | 'pending' | 'undelivered' | 'failed' | 'unknown'

/** 3000(접수)에서 이 시간(분) 이상 멈추면 "미도착 의심"으로 본다 */
export const UNDELIVERED_AFTER_MINUTES = 30

export function classifyDelivery(
  statusCode: string | null | undefined,
  sentAt: Date,
  now: Date = new Date(),
): SmsDeliveryState {
  const code = (statusCode ?? '').trim()
  if (!code) return 'unknown'
  if (code === '4000') return 'delivered'
  if (code === '2000') return 'pending'
  if (code === '3000') {
    const ageMin = (now.getTime() - sentAt.getTime()) / 60000
    return ageMin >= UNDELIVERED_AFTER_MINUTES ? 'undelivered' : 'pending'
  }
  return 'failed'
}

export const DELIVERY_LABEL: Record<SmsDeliveryState, string> = {
  delivered: '수신 완료',
  pending: '전송 중',
  undelivered: '미도착 의심',
  failed: '발송 실패',
  unknown: '결과 확인 불가',
}

export const NOTIFY_TYPE_LABEL: Record<string, string> = {
  contract_link: '전자계약서 발송',
  contract_signed: '계약서 서명 완료',
  contract_reshare: '계약서 재공유',
  reservation_approval: '예약 승인',
  shipment_notify: '반출 안내',
  tracking_notify: '운송장 등록',
  dhero_place_guide: '두발히어로 안내',
  return_registration: '반납 정보 요청',
  return_remind: '반납 예정 안내',
  reservation_cancelled: '예약 취소 안내',
  locker_guide: '무인보관함 안내',
}

export interface SolapiMsgLite {
  messageId?: string | null
  type?: string | null
  statusCode?: string | null
  reason?: string | null
  dateCreated?: string | null
  customFields?: Record<string, string> | null
}

export interface SmsLogLite {
  id: number
  notify_type: string
  status: 'sent' | 'failed'
  error_message: string | null
  created_at: string
}

/** 로그 시각과 솔라피 접수 시각이 이 범위(초) 안이면 같은 발송으로 본다(우리 서버 시계 ↔ 솔라피 접수 시각 오차 여유) */
const MATCH_WINDOW_SEC = 180

/**
 * 로그 한 건에 대응하는 솔라피 메시지를 찾는다.
 * 1순위: customFields(reservationId·notifyType)가 같은 메시지 중 시각이 가장 가까운 것(2026-10-14 이후 발송분)
 * 2순위: customFields가 없는 옛 메시지 중 접수 시각이 로그 시각과 가장 가까운 것(180초 이내)
 * 이미 다른 로그에 짝지어진 메시지는 다시 쓰지 않는다(used).
 */
export function matchSolapiMessage(
  log: SmsLogLite,
  reservationId: number,
  messages: SolapiMsgLite[],
  used: Set<string>,
): SolapiMsgLite | null {
  const t = new Date(log.created_at).getTime()
  let best: { m: SolapiMsgLite; gap: number } | null = null
  for (const m of messages) {
    const key = m.messageId ?? ''
    if (key && used.has(key)) continue
    const created = m.dateCreated ? new Date(m.dateCreated).getTime() : NaN
    if (Number.isNaN(created)) continue
    const gap = Math.abs(created - t) / 1000
    const cf = m.customFields ?? {}
    const hasTag = cf.reservationId !== undefined || cf.notifyType !== undefined
    if (hasTag) {
      if (cf.reservationId !== String(reservationId) || cf.notifyType !== log.notify_type) continue
      if (gap > MATCH_WINDOW_SEC * 10) continue
    } else if (gap > MATCH_WINDOW_SEC) {
      continue
    }
    const score = hasTag ? gap - 1e9 : gap // 태그가 맞는 메시지를 항상 우선
    if (!best || score < best.gap) best = { m, gap: score }
  }
  if (best?.m.messageId) used.add(best.m.messageId)
  return best?.m ?? null
}

export interface SmsDeliveryCard {
  log_id: number
  notify_type: string
  label: string
  sent_at: string
  kind: string | null
  state: SmsDeliveryState
  state_label: string
  status_code: string | null
  reason: string | null
}

export function buildDeliveryCards(
  logs: SmsLogLite[],
  reservationId: number,
  messages: SolapiMsgLite[],
  now: Date = new Date(),
): SmsDeliveryCard[] {
  const used = new Set<string>()
  const cards: SmsDeliveryCard[] = []
  // 오래된 로그부터 짝지어야 같은 시각대 중복 메시지가 순서대로 배정된다
  const asc = [...logs].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const log of asc) {
    const label = NOTIFY_TYPE_LABEL[log.notify_type] ?? log.notify_type
    if (log.status === 'failed') {
      cards.push({
        log_id: log.id, notify_type: log.notify_type, label, sent_at: log.created_at, kind: null,
        state: 'failed', state_label: DELIVERY_LABEL.failed, status_code: null, reason: log.error_message,
      })
      continue
    }
    const m = matchSolapiMessage(log, reservationId, messages, used)
    const state = m ? classifyDelivery(m.statusCode, new Date(log.created_at), now) : 'unknown'
    cards.push({
      log_id: log.id, notify_type: log.notify_type, label, sent_at: log.created_at,
      kind: m?.type ?? null, state, state_label: DELIVERY_LABEL[state],
      status_code: m?.statusCode ?? null, reason: m?.reason ?? null,
    })
  }
  return cards.reverse() // 최신순
}
