/**
 * 반출·운송장 알림(푸시·문자)에 붙는 택배사·운송장 번호 줄 (2026-10-27)
 * 값이 없으면 빈 문자열 — 호출부는 줄을 아예 붙이지 않는다. 채팅카드는 DB 함수가 payload 로 싣고 ActionCard 가 표시한다.
 */

import { isDheroCanceled } from '$lib/utils/dheroLabels'

/**
 * 알림에 실을 "살아 있는" 택배사·번호 — 두발히어로 쪽에서 취소된 접수(dhero_meta.canceledAt)는 번호가 DB에 남아 있어도 싣지 않는다.
 * 다른 택배사 운송장은 canceledAt 과 무관하게 그대로 쓴다. (DB 함수 send_rental_chat_notification 도 같은 기준 — Migration 775)
 */
export function liveTracking(
  courier: string | null | undefined,
  trackingNumber: string | null | undefined,
  dheroMeta: { canceledAt?: unknown } | null | undefined,
): { courier: string | null; number: string | null } {
  const number = trackingNumber?.trim() || null
  if (!number) return { courier: null, number: null }
  const c = courier?.trim() || null
  if (c === '두발히어로' && isDheroCanceled(dheroMeta)) return { courier: null, number: null }
  return { courier: c, number }
}

/** "택배사: 두발히어로\n운송장 번호: T-1" — 번호가 없으면 아무것도 보내지 않는다(택배사만으로는 안내가 되지 않음) */
export function trackingNoticeText(courier: string | null | undefined, trackingNumber: string | null | undefined): string {
  const t = trackingNumber?.trim()
  if (!t) return ''
  const c = courier?.trim()
  return [...(c ? [`택배사: ${c}`] : []), `운송장 번호: ${t}`].join('\n')
}
