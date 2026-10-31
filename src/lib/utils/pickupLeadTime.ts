/**
 * 수령일 신청 마감(리드타임) 규칙 — 장바구니 달력·제출 검증 공용 순수 함수 (KST 고정)
 *
 * 규칙: 수령일 D는 "D-N일 H시(KST)"까지 신청해야 선택 가능하다.
 *   예) 방문·퀵·무인보관함 "1일 전 오후 7시까지", 택배(배송형) "2일 전 오후 7시까지"
 *
 * 규칙 출처 우선순위:
 *   1) CMS 대여방식 안내문구(deadline_time)가 "N일 전 (오전|오후) H시" 또는 "N일 전 HH:MM" 정형이면 그 값
 *   1-1) "N일 전"이 없고 "당일 … (오전|오후) H시 까지|마감"(또는 "당일 … HH:MM 까지|마감")이면 0일 전·그 시각 — 당일 예약 허용(2026-10-30, 방문 수령)
 *   2) 그 외(자유 문구·빈값)는 기본값 — 배송형(is_delivery_type) 2일, 나머지 1일, 마감 19시
 * ⚠️ 서버 DB 함수 parse_lead_rule_text(Migration #785)와 같은 규칙이어야 한다 — 한쪽만 고치지 말 것.
 * 자유 문구를 억지로 해석하지 않는다(과거 parseInt로 "오후 7시" 문구가 NaN이 되어 내일이 통째로 막힌 결함 방지).
 */

export interface LeadRule {
  /** 수령일 며칠 전까지 신청해야 하는가 */
  leadDays: number
  /** 그 날 몇 시(KST, 0~23)까지 신청 가능한가 */
  cutoffHour: number
}

/** 읽는 최대 일수 — 이보다 큰 값(오타·터무니없는 숫자)은 해석하지 않고 기본값을 쓴다. 서버 parse_lead_rule_text 와 같다. */
const MAX_LEAD_DAYS = 365

export const DEFAULT_LEAD_RULE: LeadRule = { leadDays: 1, cutoffHour: 19 }
export const DELIVERY_LEAD_RULE: LeadRule = { leadDays: 2, cutoffHour: 19 }

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/** YYYY-MM-DD에 n일을 더한다 (UTC 산술 — 실행 환경 타임존·DST와 무관) */
function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

const KO_HOUR_WORDS: Array<[string, number]> = [
  ['열두', 12], ['열한', 11], ['열', 10], ['아홉', 9], ['여덟', 8], ['일곱', 7], ['여섯', 6], ['다섯', 5], ['네', 4], ['세', 3], ['두', 2], ['한', 1],
]

/**
 * 안내문구를 읽기 쉬운 형태로 바꾼다(전각 숫자, 하루·이틀·전날, D-N, 한글 시각 숫자, 저녁·밤·낮·아침·새벽·정오).
 * ⚠️ 서버 parse_lead_rule_text(Migration #785)가 같은 순서·같은 규칙으로 변환한다 — 한쪽만 고치지 말 것.
 */
function normalizeLeadText(raw: string): string {
  let t = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
  t = t.replace(/정오/g, '오후 12시')
  t = t.replace(/(?:하루\s*전|전날|전일)/g, '1일 전').replace(/이틀\s*전/g, '2일 전').replace(/사흘\s*전/g, '3일 전').replace(/나흘\s*전/g, '4일 전')
  t = t.replace(/(^|[^A-Za-z])[dD]\s*-\s*(\d+)/g, '$1$2일 전')
  for (const [word, n] of KO_HOUR_WORDS) {
    t = t.replace(new RegExp(`(오전|오후|저녁|밤|낮|아침|새벽)\\s*${word}\\s*시(?!간)`, 'g'), `$1 ${n}시`)
  }
  t = t.replace(/(저녁|낮)(?=\s*\d)/g, '오후').replace(/(아침|새벽)(?=\s*\d)/g, '오전')
  t = t.replace(/밤(\s*12\s*시)/g, '자정$1').replace(/밤(\s*12\s*):/g, '자정$1시:').replace(/밤(?=\s*\d)/g, '오후')
  return t
}

function ampmToHour(mer: string, h: number): number | null {
  if (h < 0 || h > 12) return null
  return mer === '오후' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h)
}

/** 시각 하나를 시(0~23)로 읽는다 — 오전·오후 시/시:분 > 7pm > HH:MM(24시간) > 13~23시. 해석 불가면 null. 1~12시(오전·오후 없음)는 모호해서 null. */
function readHour(t: string): number | null {
  let m = t.match(/(오전|오후)\s*(\d{1,2})\s*시/)
  if (m) return ampmToHour(m[1], parseInt(m[2], 10))
  m = t.match(/(오전|오후)\s*(\d{1,2})\s*:\s*\d{2}/)
  if (m) return ampmToHour(m[1], parseInt(m[2], 10))
  m = t.match(/(\d{1,2})(?:\s*:\s*\d{2})?\s*([apAP])[mM](?![a-zA-Z])/)
  if (m) return ampmToHour(m[2].toLowerCase() === 'p' ? '오후' : '오전', parseInt(m[1], 10))
  m = t.match(/(?:^|[^A-Za-z])([apAP])[mM]\s*(\d{1,2})(?:\s*:\s*\d{2})?(?!\d)/)
  if (m) return ampmToHour(m[1].toLowerCase() === 'p' ? '오후' : '오전', parseInt(m[2], 10))
  m = t.match(/(\d{1,2})\s*:\s*\d{2}/)
  if (m) {
    const h = parseInt(m[1], 10)
    return h >= 0 && h <= 23 ? h : null
  }
  m = t.match(/(\d{1,2})\s*시(?!간)/)
  if (m) {
    const h = parseInt(m[1], 10)
    return h >= 13 && h <= 23 ? h : null
  }
  return null
}

// "당일" 정형 문구 — 시각 바로 뒤(시·분 허용)에 "까지|마감|이전"이 붙은 경우만 읽는다. "당일"과 시각 사이는 숫자 없는 12글자 이내.
// (퀵의 "당일 오후 12시부터 오후 8시내에 …" 처럼 '부터'가 붙은 시각을 마감으로 오해하지 않기 위함 — 해석되지 않으면 기본값)
const SAME_DAY_PREFIX = '(?:당일|오늘|같은\\s*날)[^\\d]{0,12}'
const SAME_DAY_TAIL = '(?:\\s*\\d{1,2}\\s*분)?\\s*(?:까지|마감|이전)'
const SAME_DAY_TIME_FORMS: Array<{ re: RegExp; toHour: (m: RegExpMatchArray) => number | null }> = [
  { re: new RegExp(`${SAME_DAY_PREFIX}(오전|오후)\\s*(\\d{1,2})\\s*시${SAME_DAY_TAIL}`, 'u'), toHour: (m) => ampmToHour(m[1], parseInt(m[2], 10)) },
  { re: new RegExp(`${SAME_DAY_PREFIX}(오전|오후)\\s*(\\d{1,2})\\s*:\\s*\\d{2}${SAME_DAY_TAIL}`, 'u'), toHour: (m) => ampmToHour(m[1], parseInt(m[2], 10)) },
  { re: new RegExp(`${SAME_DAY_PREFIX}(\\d{1,2})(?:\\s*:\\s*\\d{2})?\\s*([apAP])[mM](?![a-zA-Z])${SAME_DAY_TAIL}`, 'u'), toHour: (m) => ampmToHour(m[2].toLowerCase() === 'p' ? '오후' : '오전', parseInt(m[1], 10)) },
  { re: new RegExp(`${SAME_DAY_PREFIX}([apAP])[mM]\\s*(\\d{1,2})(?:\\s*:\\s*\\d{2}|\\s*시)?${SAME_DAY_TAIL}`, 'u'), toHour: (m) => ampmToHour(m[1].toLowerCase() === 'p' ? '오후' : '오전', parseInt(m[2], 10)) },
  { re: new RegExp(`${SAME_DAY_PREFIX}(\\d{1,2})\\s*:\\s*\\d{2}${SAME_DAY_TAIL}`, 'u'), toHour: (m) => { const h = parseInt(m[1], 10); return h >= 0 && h <= 23 ? h : null } },
  { re: new RegExp(`${SAME_DAY_PREFIX}(\\d{1,2})\\s*시(?!간)${SAME_DAY_TAIL}`, 'u'), toHour: (m) => { const h = parseInt(m[1], 10); return h >= 13 && h <= 23 ? h : null } },
]

function parseSameDayRuleText(text: string): LeadRule | null {
  for (const f of SAME_DAY_TIME_FORMS) {
    const m = text.match(f.re)
    if (m) {
      const h = f.toHour(m)
      return h === null ? null : { leadDays: 0, cutoffHour: h }
    }
  }
  return null
}

/** CMS 안내문구에서 정형 규칙("N일 전 오후 7시", "하루 전 19:00", "D-2 7pm", "당일 오후 6시까지" 등)을 추출한다. 해석 불가면 null. */
export function parseLeadRuleText(text: string | null | undefined): LeadRule | null {
  if (!text) return null
  const t = normalizeLeadText(text)
  const daysMatch = t.match(/(\d+)\s*일\s*(?:전|이전)/)
  if (!daysMatch) return parseSameDayRuleText(t)
  const leadDays = parseInt(daysMatch[1], 10)
  const cutoffHour = readHour(t)
  if (cutoffHour === null || !Number.isFinite(leadDays) || leadDays > MAX_LEAD_DAYS) return null
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
