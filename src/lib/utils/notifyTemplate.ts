// src/lib/utils/notifyTemplate.ts
// 고객 알림(푸시·문자) 안내문장 템플릿 — 변수 카탈로그·치환·검증의 단일 출처(SSOT).
// 서버(발송 시 치환·저장 시 재검증)와 CMS 화면(칩 목록·미리보기·바이트 계산)이 같은 규칙을 쓴다.
// 순수 TS(서버·브라우저 공용) — $env·Supabase import 금지.
//
// 문법은 전자계약 변수와 같은 `{{변수}}`이지만 평문 전용이라 계약서 치환 유틸(HTML 이스케이프 포함)과 분리했다.

export type NotifyVarKey =
  | '고객이름'
  | '상품명'
  | '예약코드'
  | '수령일시'
  | '반납일시'
  | '할인내용'
  | '연체료'
  | '답변내용'
  | '무인함번호'
  | '무인함비밀번호'
  | '중앙현관비밀번호'
  | '반납기한'

export interface NotifyVarDef {
  key: NotifyVarKey
  label: string
  /** 화면 미리보기용 예시값 */
  sample: string
  /** 바이트 최악값 계산용 대표 최대값(실제 값이 이보다 길 수 있음 — 안내 목적의 추정치) */
  worst: string
}

export const NOTIFY_VARIABLES: Record<NotifyVarKey, NotifyVarDef> = {
  고객이름: { key: '고객이름', label: '고객 이름', sample: '홍길동', worst: '홍길동동동' },
  상품명: { key: '상품명', label: '상품명', sample: 'SONY FX3', worst: '소니 알파 A7 IV 미러리스 카메라 바디' },
  예약코드: { key: '예약코드', label: '예약코드', sample: 'CS2610001', worst: 'CS2610001-AB12' },
  수령일시: { key: '수령일시', label: '수령 일시', sample: '2026-10-12 14:00', worst: '2026-10-12 14:00' },
  반납일시: { key: '반납일시', label: '반납 일시', sample: '2026-10-14 14:00', worst: '2026-10-14 14:00' },
  할인내용: { key: '할인내용', label: '쿠폰 할인 내용', sample: '30% 할인', worst: '30,000원 할인' },
  연체료: { key: '연체료', label: '연체료', sample: '12,000원', worst: '1,000,000원' },
  답변내용: { key: '답변내용', label: '답변 내용', sample: '안녕하세요, 문의하신 내용 안내드려요.', worst: '' },
  // 무인보관함 이용 안내 전용(2026-10-11) — 비밀번호를 넣으면 잠금 화면 알림에 그대로 보일 수 있다(기본 문구는 비밀번호를 넣지 않음)
  무인함번호: { key: '무인함번호', label: '무인함 번호', sample: '1', worst: '1234567890' },
  무인함비밀번호: { key: '무인함비밀번호', label: '무인함 비밀번호', sample: '*8821', worst: '*123456789' },
  중앙현관비밀번호: { key: '중앙현관비밀번호', label: '중앙현관 비밀번호', sample: '0418*', worst: '*123456789' },
  반납기한: { key: '반납기한', label: '반납 기한(날짜·시각)', sample: '2026-10-14 14:00', worst: '2026-10-14 14:00' },
}

const RESERVATION_VARS: NotifyVarKey[] = ['고객이름', '상품명', '예약코드', '수령일시', '반납일시']

export interface NotifyTypeSpec {
  notifyType: string
  /** 이 알림에서 쓸 수 있는 변수(저장 시 이 밖의 변수는 거절) */
  vars: NotifyVarKey[]
  /** 기본 문구(코드에 고정된 현재 푸시 본문과 같은 의미) — 화면 안내·복원 미리보기용 */
  defaultMessage: string
  /** 문자(Solapi) 동시 발송 대상 여부 — false면 푸시 전용 */
  sms: boolean
}

// 문자 발송 대상은 sms.ts LIFECYCLE_SMS_COPY 의 유형과 대응한다(contract_link→contract_sent, contract_signed→contract_signed_customer).
// contract_reshare(완료 계약서 재공유)는 별도 고정 문구라 편집 대상이 아니다.
export const NOTIFY_SPECS: NotifyTypeSpec[] = [
  { notifyType: 'reservation_hold', vars: RESERVATION_VARS, sms: false, defaultMessage: '{{상품명}} 예약 신청이 접수됐어요. 전자계약서 발송을 기다려주세요.' },
  { notifyType: 'reservation_approval', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 대여가 확정됐어요. 수령 안내를 확인해주세요.' },
  { notifyType: 'shipment_notify', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}}이(가) 발송됐어요.' },
  { notifyType: 'rental_confirm', vars: RESERVATION_VARS, sms: false, defaultMessage: '{{상품명}} 수령이 확인되어 대여가 시작됐어요.' },
  { notifyType: 'return_registration', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납 정보를 등록해주세요.' },
  { notifyType: 'return_remind', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납예정일이 다가와요. 반납 방법을 확인해주세요.' },
  { notifyType: 'rental_complete', vars: RESERVATION_VARS, sms: false, defaultMessage: '{{상품명}} 대여가 정상적으로 종료됐어요. 이용해주셔서 감사합니다.' },
  { notifyType: 'reservation_cancelled', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 예약이 취소됐어요. 자세한 내용은 채팅을 확인해주세요.' },
  { notifyType: 'damage_claimed', vars: RESERVATION_VARS, sms: false, defaultMessage: '{{상품명}} 파손 신고가 접수됐어요. 담당자가 확인 후 안내드릴게요.' },
  { notifyType: 'tracking_notify', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 운송장 번호가 등록됐어요. 채팅에서 배송 정보를 확인해주세요.' },
  // 무인보관함 이용 안내(2026-10-11, Stephen 확정): 이 안내문장이 푸시·문자·채팅카드 세 곳의 공통 정본이다(비우면 아래 기본 문구).
  // 문자는 SMS_BRAND_PREFIX가 앞에 붙고 길면 LMS로 나간다. 비밀번호가 푸시 알림 본문에도 들어가므로 해당 고객 1명에게만 발송된다.
  { notifyType: 'locker_guide', vars: [...RESERVATION_VARS, '무인함번호', '무인함비밀번호', '중앙현관비밀번호', '반납기한'], sms: true, defaultMessage: "{{상품명}} 무인보관함 이용 {{무인함번호}}번함 비밀번호는 '{{무인함비밀번호}}'입니다.\n중앙현관 비밀번호: {{중앙현관비밀번호}}" },
  // 반납 방식별 단계 알림(2026-10-17, Migration #722) — 푸시·문자 공통 안내문장(채팅카드는 크론이 같은 기본 문구를 보낸다)
  { notifyType: 'return_notice_courier', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납일이에요. 크레이지배송 반납 방법을 확인하고 반납요청을 등록해 주세요.' },
  { notifyType: 'return_notice_quick_5h', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 퀵서비스 반납 안내예요. 대여 종료 시간은 매장 도착 기준이에요.' },
  { notifyType: 'return_notice_quick_2h', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납 종료 2시간 전이에요. 반납을 준비해 주세요.' },
  { notifyType: 'return_notice_quick_1h', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납 종료 1시간 전이에요. 서둘러 반납을 준비해 주세요.' },
  { notifyType: 'return_notice_locker', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 반납 3시간 전이에요. 반납 후 무인함 정보를 입력해 주세요. 종료 시간까지 입력이 없으면 지연 연체 요금이 발생할 수 있어요!' },
  // 반납 검수 결과(2026-10-17, Migration #724) — 관리자가 검수 승인 / 이슈 등록할 때 고객에게 나간다
  { notifyType: 'issue_report_request', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 장비 이상·파손·분실 접수를 위해 사진·영상 등 증빙 자료를 등록해 주세요.' },
  { notifyType: 'inspection_pass', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 검수 결과, 장비 및 구성품에 이상이 없어 대여가 완료되었습니다. 이용해 주셔서 감사합니다.' },
  { notifyType: 'inspection_issue', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 검수 결과, 장비 및 구성품에 이상이 확인되어 추가 확인 후 담당자가 연락드리겠습니다.' },
  { notifyType: 'dhero_place_guide', vars: RESERVATION_VARS, sms: true, defaultMessage: '{{상품명}} 두발히어로 배송이 접수됐어요. 채팅에서 수령 위치를 등록해 주세요.' },
  { notifyType: 'payment_cancelled_reissue', vars: RESERVATION_VARS, sms: false, defaultMessage: '{{상품명}} 기존 결제가 취소됐어요. 잠시 후 새 계약서가 발송됩니다.' },
  { notifyType: 'event_coupon_issued', vars: ['고객이름', '할인내용'], sms: false, defaultMessage: '{{할인내용}} 쿠폰을 받으셨어요! 지금 확인해보세요.' },
  { notifyType: 'admin_chat_reply', vars: ['고객이름', '답변내용'], sms: false, defaultMessage: '{{답변내용}}' },
  { notifyType: 'chat_unanswered', vars: ['고객이름'], sms: false, defaultMessage: '문의하신 내용에 아직 답변이 없어요. 잠시 후 다시 확인해 주세요.' },
  { notifyType: 'contract_sent', vars: ['고객이름'], sms: true, defaultMessage: '계약서를 확인하고 서명해주세요.' },
  { notifyType: 'contract_signed_customer', vars: ['고객이름', '예약코드'], sms: true, defaultMessage: '{{예약코드}} 예약의 서명이 정상 접수됐어요.' },
  { notifyType: 'identity_approved', vars: ['고객이름'], sms: false, defaultMessage: '본인증명정보가 정상적으로 확인됐어요.' },
  { notifyType: 'identity_request', vars: ['고객이름'], sms: false, defaultMessage: '개인정보 메뉴에서 본인증명정보를 등록해주세요.' },
  { notifyType: 'late_fee_paid', vars: ['고객이름', '연체료'], sms: false, defaultMessage: '연체료 {{연체료}} 결제가 정상 처리됐어요.' },
  { notifyType: 'ai_auto_reply', vars: ['고객이름', '답변내용'], sms: false, defaultMessage: '{{답변내용}}' },
  { notifyType: 'canned_auto_reply', vars: ['고객이름', '답변내용'], sms: false, defaultMessage: '{{답변내용}}' },
]

const SPEC_BY_TYPE = new Map(NOTIFY_SPECS.map((s) => [s.notifyType, s]))

export function getNotifySpec(notifyType: string): NotifyTypeSpec | undefined {
  return SPEC_BY_TYPE.get(notifyType)
}

/** sms.ts 발송 유형(LIFECYCLE_SMS_COPY 키) → 안내문장이 저장된 설정 유형. 매핑 없으면 편집 대상 아님(null). */
export function smsTypeToConfigType(smsNotifyType: string): string | null {
  if (smsNotifyType === 'contract_link') return 'contract_sent'
  if (smsNotifyType === 'contract_signed') return 'contract_signed_customer'
  if (smsNotifyType === 'contract_reshare') return null
  return smsNotifyType
}

export type NotifyVars = Partial<Record<NotifyVarKey, string>>

const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

export const MAX_NOTIFY_MESSAGE_CHARS = 1000
const MAX_PUSH_ONLY_CHARS = 500

/** 본문에 쓰인 변수 이름 목록(중복 제거, 등장 순서) */
export function extractVariables(template: string): string[] {
  const found: string[] = []
  for (const m of template.matchAll(VAR_PATTERN)) {
    if (!found.includes(m[1])) found.push(m[1])
  }
  return found
}

/** 이 알림 유형에서 허용되지 않는 변수 이름 목록 */
export function findUnknownVariables(notifyType: string, template: string): string[] {
  const spec = getNotifySpec(notifyType)
  if (!spec) return extractVariables(template)
  const allowed = new Set<string>(spec.vars)
  return extractVariables(template).filter((v) => !allowed.has(v))
}

/**
 * 변수 치환. 값이 없는 변수는 빈 문자열로 바꾸고 생긴 연속 공백을 정리한다(알림이 막히지 않게 fail-soft).
 * 알 수 없는 변수도 빈 문자열이 된다 — 저장 단계에서 이미 거절되므로 정상 흐름에선 발생하지 않는다.
 */
export function applyNotifyTemplate(template: string, vars: NotifyVars): string {
  const out = template.replace(VAR_PATTERN, (_all, name: string) => {
    const value = (vars as Record<string, string | undefined>)[name]
    return value ?? ''
  })
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim()
}

/**
 * SMS 바이트 길이 — 한글·전각 2바이트, ASCII 1바이트. 줄바꿈은 CRLF로 전달될 수 있어 보수적으로 2바이트로 센다
 * (SMS/LMS 경계에서 SMS로 잘못 분류돼 발송이 거절되는 것을 막기 위해 한 쪽으로만 틀리게 한다).
 */
export function smsByteLength(text: string): number {
  let bytes = 0
  for (const ch of text) {
    if (ch === '\n') {
      bytes += 2
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : 2
  }
  return bytes
}

export const SMS_MAX_BYTES = 90
export const LMS_MAX_BYTES = 2000

export type SmsKind = 'SMS' | 'LMS' | 'OVER'

export function classifySms(bytes: number): SmsKind {
  if (bytes <= SMS_MAX_BYTES) return 'SMS'
  if (bytes <= LMS_MAX_BYTES) return 'LMS'
  return 'OVER'
}

// 제어문자(줄바꿈 제외)·방향 제어·제로폭 문자 — 푸시·문자 모두에서 깨지거나 보이지 않게 섞여 들어오는 문자
// eslint-disable-next-line no-control-regex -- 제어문자 검출이 목적
const INVISIBLE_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/
// 링크·주소 감지: http(s) 링크, www., 도메인만 적은 주소(예: crazyshot.kr)
const EXTERNAL_LINK_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:kr|com|net|org|io|me|app|co)\b/i
const EMOJI_PATTERN = /\p{Extended_Pictographic}|️|‍/u

export const SMS_BRAND_PREFIX = '[크레이지샷] '

// 문자 본문에 덧붙는 링크의 대략적 길이(자동 부착분 — sms.ts가 'http'가 없으면 줄바꿈 후 링크를 붙인다)
function smsLinkBudget(notifyType: string): number {
  return notifyType === 'contract_sent' ? 70 : 40
}

export interface NotifyMessageEstimate {
  /** 대표 최대값으로 치환한 최악 본문(문자 대상 유형이면 접두어·링크 포함) */
  worstText: string
  smsBytes: number
  smsKind: SmsKind
}

/** 최악 길이 추정 — 변수를 대표 최대값으로 치환하고, 문자 대상이면 접두어와 자동 링크 분을 더한다. */
export function estimateNotifyMessage(notifyType: string, template: string): NotifyMessageEstimate {
  const spec = getNotifySpec(notifyType)
  const worstVars: NotifyVars = {}
  for (const def of Object.values(NOTIFY_VARIABLES)) worstVars[def.key] = def.worst
  const body = applyNotifyTemplate(template, worstVars)
  if (!spec?.sms) {
    const bytes = smsByteLength(body)
    return { worstText: body, smsBytes: bytes, smsKind: classifySms(bytes) }
  }
  let text = `${SMS_BRAND_PREFIX}${body}`
  if (!text.includes('http')) text += `\n${'x'.repeat(smsLinkBudget(notifyType))}`
  const bytes = smsByteLength(text)
  return { worstText: text, smsBytes: bytes, smsKind: classifySms(bytes) }
}

export interface NotifyMessageValidation {
  ok: boolean
  /** 저장을 막는 사유(사용자에게 그대로 보여줄 문구) */
  error?: string
  /** 저장은 되지만 알려야 할 사항 */
  warnings: string[]
  smsBytes: number
  smsKind: SmsKind
}

/**
 * 저장 전 검증 — 서버 액션이 최종 재검증하고, 화면은 같은 함수로 실시간 안내한다.
 * 빈 문장은 "기본 문구로 복원"이라 항상 통과한다.
 */
export function validateNotifyMessage(notifyType: string, message: string): NotifyMessageValidation {
  const spec = getNotifySpec(notifyType)
  const base = { warnings: [] as string[], smsBytes: 0, smsKind: 'SMS' as SmsKind }
  if (!spec) return { ...base, ok: false, error: '알 수 없는 알림 유형입니다.' }

  const text = message.replace(/\r\n/g, '\n')
  if (text.trim() === '') return { ...base, ok: true }

  if (text.length > MAX_NOTIFY_MESSAGE_CHARS) {
    return { ...base, ok: false, error: `문장은 ${MAX_NOTIFY_MESSAGE_CHARS}자 이하로 입력해 주세요.` }
  }
  if (!spec.sms && text.length > MAX_PUSH_ONLY_CHARS) {
    return { ...base, ok: false, error: `이 알림은 ${MAX_PUSH_ONLY_CHARS}자 이하로 입력해 주세요.` }
  }

  const unknown = findUnknownVariables(notifyType, text)
  if (unknown.length > 0) {
    return { ...base, ok: false, error: `이 알림에서 쓸 수 없는 변수입니다: ${unknown.map((v) => `{{${v}}}`).join(', ')}` }
  }

  // 변수 괄호가 짝이 안 맞는 경우(오타) — 치환되지 않은 채 고객에게 그대로 노출되는 것을 막는다
  const stripped = text.replace(VAR_PATTERN, '')
  if (/\{\{|\}\}/.test(stripped)) {
    return { ...base, ok: false, error: '변수 표시 {{ }} 가 올바르게 닫히지 않았습니다.' }
  }

  if (INVISIBLE_PATTERN.test(text)) {
    return { ...base, ok: false, error: '눈에 보이지 않는 특수문자(제어문자·방향 문자 등)는 사용할 수 없습니다.' }
  }
  if (spec.sms && EMOJI_PATTERN.test(text)) {
    return { ...base, ok: false, error: '문자로도 발송되는 알림이라 이모지는 사용할 수 없습니다.' }
  }

  const est = estimateNotifyMessage(notifyType, text)
  if (spec.sms && est.smsKind === 'OVER') {
    return { ...base, ok: false, error: `문자 본문이 ${LMS_MAX_BYTES}바이트를 넘습니다(최대 ${est.smsBytes}바이트). 문장을 줄여 주세요.` }
  }

  const warnings: string[] = []
  if (spec.sms && est.smsKind === 'LMS') {
    warnings.push(`문자 본문이 ${SMS_MAX_BYTES}바이트를 넘어 장문(LMS)으로 발송됩니다(최대 ${est.smsBytes}바이트 추정).`)
  }
  // 문자 대상 알림은 수신동의와 무관하게 항상 발송되는 안내라, 링크·주소가 들어가면 스팸·광고 오해가 생긴다 — 저장은 허용하되 알린다.
  // 자동 링크 첨부 여부는 sms.ts와 같은 기준(소문자 'http' 포함 여부)으로 안내해 경고문과 실제 동작이 어긋나지 않게 한다.
  if (spec.sms && notifyType !== 'locker_guide' && EXTERNAL_LINK_PATTERN.test(text)) {
    warnings.push(
      text.includes('http')
        ? '문장에 링크(http)가 있어 자동 링크 첨부는 생략됩니다. 문자는 수신 동의와 무관하게 발송되는 안내이므로 광고·외부 링크는 넣지 않는 것이 좋습니다.'
        : '문장에 주소(www·도메인)가 있어도 자동 링크가 한 번 더 첨부되어 주소가 두 번 나갈 수 있습니다. 광고·외부 주소는 넣지 않는 것이 좋습니다.',
    )
  }
  return { ok: true, warnings, smsBytes: est.smsBytes, smsKind: est.smsKind }
}


/**
 * 무인보관함 이용 안내 문장 렌더링 — 값이 없는 부분을 어색하게 남기지 않는다(2026-10-11).
 *  · 중앙현관 비밀번호가 없으면 그 변수가 들어 있는 줄 전체를 뺀다
 *  · 무인함 번호가 없으면(번호 도입 전 옛 저장분) "{{무인함번호}}번함" 부분을 뺀다
 * 푸시·문자·채팅카드가 모두 이 함수로 같은 결과를 만든다.
 */
export function renderLockerGuideMessage(template: string, vars: NotifyVars): string {
  let t = template
  if (!vars.중앙현관비밀번호) {
    t = t.split('\n').filter((line) => !line.includes('{{중앙현관비밀번호}}')).join('\n')
  }
  if (!vars.무인함번호) {
    t = t.replace(/\{\{무인함번호\}\}\s*번함\s?/g, '')
  }
  return applyNotifyTemplate(t, vars).trim()
}
