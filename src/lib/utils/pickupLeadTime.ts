/**
 * 수령일 신청 마감(리드타임) 규칙 — 장바구니 달력·제출 검증 공용 순수 함수 (KST 고정)
 *
 * 규칙: 수령일 D는 "D-N일 H시(KST)"까지 신청해야 선택 가능하다.
 *   예) 방문·퀵·무인보관함 "1일 전 오후 7시까지", 택배(배송형) "2일 전 오후 7시까지"
 *
 * 규칙 출처 우선순위:
 *   1) CMS 대여방식 안내문구(deadline_time)가 "N일 전 (오전|오후) H시" 또는 "N일 전 HH:MM" 정형이면 그 값
 *   2) 그 외(자유 문구·빈값)는 기본값 — 배송형(is_delivery_type) 2일, 나머지 1일, 마감 19시
 * 자유 문구를 억지로 해석하지 않는다(과거 parseInt로 "오후 7시" 문구가 NaN이 되어 내일이 통째로 막힌 결함 방지).
 */

export interface LeadRule {
  /** 수령일 며칠 전까지 신청해야 하는가 */
  leadDays: number
  /** 그 날 몇 시(KST, 0~23)까지 신청 가능한가 */
  cutoffHour: number
}

export const DEFAULT_LEAD_RULE: LeadRule = { leadDays: 1, cutoffHour: 19 }
export const DELIVERY_LEAD_RULE: LeadRule = { leadDays: 2, cutoffHour: 19 }

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/** YYYY-MM-DD에 n일을 더한다 (UTC 산술 — 실행 환경 타임존·DST와 무관) */
function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** CMS 안내문구에서 정형 규칙("N일 전 오후 7시" 등)을 추출한다. 해석 불가면 null. */
export function parseLeadRuleText(text: string | null | undefined): LeadRule | null {
  if (!text) return null
  const daysMatch = text.match(/(\d+)\s*일\s*전/)
  if (!daysMatch) return null
  const leadDays = parseInt(daysMatch[1], 10)

  let cutoffHour: number | null = null
  const ampm = text.match(/(오전|오후)\s*(\d{1,2})\s*시/)
  if (ampm) {
    const h = parseInt(ampm[2], 10)
    if (h >= 0 && h <= 12) {
      cutoffHour = ampm[1] === '오후' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h)
    }
  } else {
    const hhmm = text.match(/(\d{1,2})\s*:\s*\d{2}/)
    if (hhmm) {
      const h = parseInt(hhmm[1], 10)
      if (h >= 0 && h <= 23) cutoffHour = h
    }
  }
  if (cutoffHour === null || !Number.isFinite(leadDays)) return null
  return { leadDays, cutoffHour }
}

/** 방식의 실제 적용 규칙 — 정형 문구 > 기본값(배송형 2일 / 그 외 1일) */
export function resolveLeadRule(o: { isDeliveryType: boolean; deadlineText?: string | null }): LeadRule {
  return parseLeadRuleText(o.deadlineText) ?? (o.isDeliveryType ? DELIVERY_LEAD_RULE : DEFAULT_LEAD_RULE)
}

/** 지금(KST) 기준 선택 가능한 가장 이른 수령일 (YYYY-MM-DD) */
export function minPickupDate(rule: LeadRule, nowMs: number): string {
  const kstNow = new Date(nowMs + KST_OFFSET_MS)
  const todayKst = kstNow.toISOString().slice(0, 10)
  const beforeCutoff = kstNow.getUTCHours() < rule.cutoffHour
  return addDaysIso(todayKst, rule.leadDays + (beforeCutoff ? 0 : 1))
}

/** 수령일이 신청 마감을 넘겨 선택 불가인가 */
export function isPickupDateBlocked(iso: string, rule: LeadRule, nowMs: number): boolean {
  return iso < minPickupDate(rule, nowMs)
}

/**
 * 최대 반납일. 수령일·최대일수가 없으면 제한 없음(undefined).
 * 배송형은 요금이 "날짜차+1일"(포함 일수)이라 상한이 max-1, 일반 방식은 "차이×24h"라 상한이 max.
 */
export function maxReturnDate(
  pickupIso: string | null | undefined,
  maxRentalDays: number | null | undefined,
  inclusiveDayCount: boolean,
): string | undefined {
  if (!pickupIso || !maxRentalDays || maxRentalDays <= 0) return undefined
  return addDaysIso(pickupIso, inclusiveDayCount ? maxRentalDays - 1 : maxRentalDays)
}

export function leadTimeMessage(rule: LeadRule): string {
  const h = rule.cutoffHour
  const label = h === 12 ? '오후 12시' : h === 0 ? '오전 12시' : h > 12 ? `오후 ${h - 12}시` : `오전 ${h}시`
  return `선택한 수령일은 신청 마감(대여일 ${rule.leadDays}일 전 ${label})이 지났습니다.`
}

/** 서버 검증 예외 접두사(PICKUP_LEAD_TIME:·RENTAL_PERIOD_EXCEEDED:, Migration 588)를 떼고 고객용 문구만 남긴다 */
export function stripServerGuardPrefix(message: string | null | undefined): string | undefined {
  if (!message) return undefined
  return message.replace(/^(PICKUP_LEAD_TIME|RENTAL_PERIOD_EXCEEDED|DOC_NOT_APPROVED):\s*/, '')
}

/** 지금(KST)의 날짜 YYYY-MM-DD */
export function kstDateIso(nowMs: number): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 수령일의 신청 마감 시각(epoch ms) — "수령일 N일 전 H시(KST)".
 * minPickupDate와 같은 기준: 이 시각 이전(nowMs < cutoff)이면 그 수령일을 아직 신청·취소할 수 있다.
 */
export function pickupCutoffMs(startDateIso: string, rule: LeadRule): number {
  return Date.parse(`${startDateIso}T00:00:00Z`) - rule.leadDays * DAY_MS + rule.cutoffHour * 3_600_000 - KST_OFFSET_MS
}
