import { dev } from '$app/environment'
import { env } from '$env/dynamic/private'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'
import { SMS_BRAND_PREFIX, classifySms, smsByteLength } from '$lib/utils/notifyTemplate'

// SMS 발송: Solapi SDK (HMAC 서명 인증 — IP 등록 불필요, Vercel 서버리스에 최적)
// env 미설정 시 SMS 미전송 (graceful skip) — api/profile/send-otp에서 이동(2026-08-20,
// 무인보관함 안내 발송과 공유하기 위해 메시지 본문을 인자로 받는 범용 형태로 일반화).
// 2026-09-10: Aligo(IP 화이트리스트 필수) → Solapi(HMAC 인증, IP 제약 없음)로 전면 교체.
// customFields(2026-10-14): 솔라피 메시지에 예약번호·알림유형을 심어 두면 발송 결과 조회 때 우리 로그와 정확히 짝지어진다
// (CMS 예약 상세 "알림발송" 탭). 값은 문자열만 허용되며 수신자에게는 보이지 않는다.
export async function sendSms(to: string, message: string, customFields?: Record<string, string>): Promise<void> {
  const apiKey      = env.SOLAPI_API_KEY
  const apiSecret   = env.SOLAPI_API_SECRET
  const senderPhone = env.SMS_SENDER_PHONE

  // 키 미설정 시 graceful skip — 로컬 개발 중 OTP 발송 경로가 에러 없이 통과되도록 보장
  if (!apiKey || !apiSecret || !senderPhone) {
    return
  }

  const service = new SolapiMessageService(apiKey, apiSecret)

  // 수신번호·발신번호 양쪽 모두 숫자만 남긴다 — Solapi는 하이픈 불가이고, 복사·붙여넣기로 들어간 보이지 않는
  // 방향 제어문자(U+202D/U+202C 등)가 섞인 번호는 발송이 실패하므로 하이픈뿐 아니라 숫자 외 전부 제거한다.
  const toClean   = to.replace(/[^0-9]/g, '')
  const fromClean = senderPhone.replace(/[^0-9]/g, '')
  if (!toClean) throw new Error('SMS 수신번호 형식 오류')

  // 길이에 따라 SMS(≤90B)/LMS(≤2000B)를 명시한다 — 자동 판별에 맡기지 않아 동작이 결정적이다.
  // 짧은 문자(OTP 등)는 이전과 동일하게 SMS로 나간다.
  const kind = classifySms(smsByteLength(message))
  if (kind === 'OVER') throw new Error('SMS 본문이 2000바이트를 초과합니다')

  const res = await service.send({
    to:   toClean,
    from: fromClean,
    text: message,
    type: kind,
    ...(kind === 'LMS' ? { subject: '[크레이지샷]' } : {}),
    ...(customFields ? { customFields } : {}),
  })

  if (res.failedMessageList.length > 0) {
    const first = res.failedMessageList[0]
    throw new Error(`SMS 발송 실패: ${JSON.stringify(first)}`)
  }
}

// 무인보관함 안내 문자 본문 — 크론(/api/cron/locker-guide)과 CMS "시범 발송"이 같은 문구를 쓰도록 한 곳에서 만든다.
// 형식: [크레이지샷] 상품명 대여예약 무인보관함 이용정보 No {무인함 번호} / {비밀번호} (2026-10-08, Stephen 확정).
// 무인함 번호가 없는 옛 데이터(번호 도입 전 저장분)는 "No … /" 부분 없이 비밀번호만 안내한다.
export function buildLockerGuideSms(
  productName: string | null | undefined,
  lockerNumber: string | null | undefined,
  password: string,
  entrancePassword?: string | null,
): string {
  const head = `[크레이지샷] ${productName ?? '상품'} 대여예약 무인보관함 이용정보`
  const no = (lockerNumber ?? '').trim()
  const body = no ? `${head} No ${no} / ${password}` : `${head} ${password}`
  // 중앙현관 비밀번호(CMS 푸시알림 설정에서 수정, 2026-10-11) — 설정이 없으면 줄을 넣지 않는다
  const entrance = (entrancePassword ?? '').trim()
  return entrance ? `${body}\n중앙현관 비밀번호: ${entrance}` : body
}

// 무인보관함 "반납" 안내 문자 고정 문구 — 공통 안내문장(locker_return_guide) 조립이 실패했을 때만 쓰는 예비 문구(2026-10-31).
export function buildLockerReturnGuideSms(
  productName: string | null | undefined,
  lockerNumber: string | null | undefined,
  password: string,
  entrancePassword?: string | null,
): string {
  const head = `[크레이지샷] ${productName ?? '상품'} 반납 무인보관함 이용정보`
  const no = (lockerNumber ?? '').trim()
  const body = no ? `${head} No ${no} / ${password}\n반납 후 반납정보 등록에서 무인함 정보를 입력해 주세요.` : `${head} ${password}\n반납 후 반납정보 등록에서 무인함 정보를 입력해 주세요.`
  const entrance = (entrancePassword ?? '').trim()
  return entrance ? `${body}\n중앙현관 비밀번호: ${entrance}` : body
}

// ─────────────────────────────────────────────────────────────────────────────
// 예약 라이프사이클 SMS 허브 — 3축(채팅카드+FCM+SMS) 동시 발송 체계 (2026-10-02)
// ─────────────────────────────────────────────────────────────────────────────
// 규칙(Stephen 확정):
//  1. locker_guide 제외 — 이 cron은 이미 도어코드 포함 자체 SMS를 보냄, 중복 방지
//  2. 블랙리스트·allow_rental_alert 무관 — 대여 관련 SMS는 항상 발송
//  3. phone 없음·탈퇴(requested/purged)·미대상 타입·개발환경 → 스킵
//  4. 같은 날(KST) 동일 (reservation_id, notify_type) 중복 → 스킵
//     단, force=true 또는 contract_link 타입은 항상 발송(재공유 contract_reshare는 호출부가 force=true로 보낸다)

export const LIFECYCLE_SMS_COPY: Record<string, (productName: string, link?: string) => string> = {
  contract_link: (p, link) =>
    `[크레이지샷] ${p} 전자계약서가 도착했어요. 서명을 완료해 주세요.\n${link ?? 'crazyshot.kr'}`,
  contract_signed: (p, link) =>
    `[크레이지샷] ${p} 계약서 서명이 완료됐어요.\n${link ?? 'crazyshot.kr'}`,
  // 완료 전자계약서 재공유(share-chat, 2026-10-08) — 서명 완료 문구와 구분되는 별도 문구
  contract_reshare: (p, link) =>
    `[크레이지샷] ${p} 전자계약서를 다시 확인해주세요.\n${link ?? 'crazyshot.kr'}`,
  reservation_approval: (p) =>
    `[크레이지샷] ${p} 예약이 승인됐어요! 수령 안내는 crazyshot.kr에서 확인해 주세요.`,
  shipment_notify: (p) =>
    `[크레이지샷] ${p} 장비가 발송됐어요. crazyshot.kr에서 배송 정보를 확인해 주세요.`,
  tracking_notify: (p) =>
    `[크레이지샷] ${p} 운송장 번호가 등록됐어요. crazyshot.kr에서 배송 추적을 확인해 주세요.`,
  dhero_place_guide: (p) =>
    `[크레이지샷] ${p} 두발히어로 배송 안내입니다. crazyshot.kr에서 확인해 주세요.`,
  return_registration: (p) =>
    `[크레이지샷] ${p} 반납 정보를 등록해 주세요. crazyshot.kr에서 확인해 주세요.`,
  return_remind: (p) =>
    `[크레이지샷] ${p} 반납예정일이 다가와요. crazyshot.kr에서 반납 방법을 확인해 주세요.`,
  reservation_cancelled: (p) =>
    `[크레이지샷] ${p} 예약이 취소됐어요. 문의는 crazyshot.kr로 연락해 주세요.`,
  // 반납 방식별 단계 알림(2026-10-17, Migration #722) — 링크는 반납 제출 화면(defaultLinkPath)
  return_notice_courier: (p) =>
    `[크레이지샷] ${p} 반납일이에요. 크레이지배송 반납 방법을 확인하고 반납요청을 등록해 주세요.`,
  return_notice_quick_5h: (p) =>
    `[크레이지샷] ${p} 퀵서비스 반납 안내예요. 대여 종료 시간은 매장 도착 기준이에요.`,
  return_notice_quick_2h: (p) =>
    `[크레이지샷] ${p} 반납 종료 2시간 전이에요. 반납을 준비해 주세요.`,
  return_notice_quick_1h: (p) =>
    `[크레이지샷] ${p} 반납 종료 1시간 전이에요. 서둘러 반납을 준비해 주세요.`,
  // 반납 검수 결과(2026-10-17, Migration #724)
  // CS 사전 이슈 접수 증빙 요청(3단계, Migration #728) — 링크는 호출부가 smsLink 로 증빙 폼 주소를 넘긴다
  issue_report_request: (p) =>
    `[크레이지샷] ${p} 장비 이상·파손·분실 접수를 위해 사진·영상 등 증빙 자료를 등록해 주세요.`,
  inspection_pass: (p) =>
    `[크레이지샷] 대여 완료 안내\n${p} 검수 결과, 장비 및 구성품에 이상이 없어 대여가 완료되었습니다. 이용해 주셔서 감사합니다.`,
  inspection_issue: (p) =>
    `[크레이지샷] 검수 결과 안내\n${p} 검수 결과, 장비 및 구성품에 이상이 확인되어 추가 확인 후 담당자가 연락드리겠습니다.`,
  return_notice_locker: (p) =>
    `[크레이지샷] ${p} 반납 3시간 전이에요. 반납 후 무인함 정보를 입력해 주세요. 종료 시간까지 입력이 없으면 지연 연체 요금이 발생할 수 있어요!`,
}

export interface SendLifecycleSmsParams {
  phone: string
  userId: string
  notifyType: string
  productName: string
  reservationId: number
  /** 본문에 붙일 링크(절대 URL 또는 사이트 상대경로). 미지정 시 타입별 기본 경로 */
  linkOverride?: string
  force?: boolean
  /** CMS에서 편집한 안내문장(변수 치환 완료본, 접두어 제외). 있으면 기본 문구 대신 `[크레이지샷] ` + 이 문장을 쓴다. */
  customMessage?: string | null
  /** 반출·운송장 알림의 "택배사/운송장 번호" 줄(기본 문구일 때만 본문 뒤에 붙인다. 편집 문장은 변수로 직접 넣는다) */
  trackingText?: string
}

const SITE_URL = 'https://crazyshot.kr'

function defaultLinkPath(notifyType: string, reservationId: number): string {
  switch (notifyType) {
    case 'return_remind':    return `/account/rental/${reservationId}/history`
    case 'return_notice_courier':
    case 'return_notice_quick_5h':
    case 'return_notice_quick_2h':
    case 'return_notice_quick_1h':
    case 'return_notice_locker': return `/account/rental/${reservationId}/return-submit`
    case 'contract_signed':  return `/account/rental/${reservationId}/contract`
    case 'contract_reshare': return `/account/rental/${reservationId}/contract`
    default:                 return '/account/rental'
  }
}

function toAbsoluteUrl(link: string): string {
  return /^https?:\/\//.test(link) ? link : `${SITE_URL}${link.startsWith('/') ? '' : '/'}${link}`
}

// KST(UTC+9) 기준 날짜 경계 — 중복 판정용
function kstDayRangeIso(): { from: string; to: string } {
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  return { from: `${kstDate}T00:00:00+09:00`, to: `${kstDate}T23:59:59.999+09:00` }
}

// 에러 메시지에 섞인 전화번호 등 연속 숫자(7자리 이상)를 가려 저장한다(개인정보 보호)
function maskDigits(text: string): string {
  return text.replace(/\d{7,}/g, (m) => '*'.repeat(m.length - 4) + m.slice(-4)).slice(0, 500)
}

async function insertSmsLog(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  // 로그 저장 실패는 발송 흐름(채팅카드·푸시·SMS)에 영향을 주지 않지만 조용히 삼키지는 않는다 — supabase는 throw하지 않고 {error}를 돌려주므로 반드시 확인한다.
  // (2026-10-08: 같은 날 두 번째 재공유 로그가 고유 인덱스 위반으로 조용히 누락돼 관리자 카드의 "SMS 발송 성공" 표시가 어긋났는데, 오류가 어디에도 남지 않아 발견이 늦었다.)
  // 오류 문구에는 키 값이 섞일 수 있어 연속 숫자는 가려 남긴다.
  try {
    const { error } = await admin.from('sms_notification_logs').insert(row)
    if (error) {
      console.error('[lifecycle-sms] 발송 로그 저장 실패:', row.notify_type, row.status, maskDigits((error as { message?: string }).message ?? String(error)))
    }
  } catch (e) {
    console.error('[lifecycle-sms] 발송 로그 저장 예외:', row.notify_type, row.status, maskDigits(e instanceof Error ? e.message : String(e)))
  }
}

export async function sendLifecycleSms(
  admin: SupabaseClient,
  params: SendLifecycleSmsParams,
): Promise<{ sent: boolean; reason: string }> {
  const { phone, userId, notifyType, productName, reservationId, linkOverride, force, customMessage, trackingText } = params

  // 개발 환경: 실제 발송 없이 건너뜀(로컬에서 실번호로 문자가 나가는 사고 방지)
  if (dev) return { sent: false, reason: 'dev' }

  if (!phone) return { sent: false, reason: 'no_phone' }

  // SMS 문구가 없는 타입(locker_guide 등)은 스킵
  const msgFn = LIFECYCLE_SMS_COPY[notifyType]
  if (!msgFn) return { sent: false, reason: 'no_copy' }

  try {
    // 탈퇴 상태 확인 — requested/purged는 SMS 미발송
    const { data: profile } = await admin
      .from('user_profiles')
      .select('withdrawal_status')
      .eq('id', userId)
      .maybeSingle()
    const withdrawalStatus = (profile as { withdrawal_status?: string | null } | null)?.withdrawal_status ?? 'none'
    if (withdrawalStatus === 'requested' || withdrawalStatus === 'purged') {
      return { sent: false, reason: 'withdrawn' }
    }

    // 중복 체크 — 같은 날(KST) 동일 (reservation_id, notify_type) 이미 발송된 경우 스킵.
    // force=true 또는 contract_link(재발송 허용)는 우회.
    if (!force && notifyType !== 'contract_link') {
      const { from, to } = kstDayRangeIso()
      const { data: existing, error: dedupErr } = await admin
        .from('sms_notification_logs')
        .select('id')
        .eq('reservation_id', reservationId)
        .eq('notify_type', notifyType)
        .eq('status', 'sent')
        .gte('created_at', from)
        .lte('created_at', to)
        .limit(1)
        .maybeSingle()
      if (dedupErr) console.error('[lifecycle-sms] 중복 조회 실패(로그 테이블 확인 필요):', dedupErr.message)
      if (existing) return { sent: false, reason: 'duplicate' }
    }

    const link = toAbsoluteUrl(linkOverride ?? defaultLinkPath(notifyType, reservationId))
    let message = customMessage ? `${SMS_BRAND_PREFIX}${customMessage}` : msgFn(productName, link)
    if (!customMessage && trackingText) message = `${message}\n${trackingText}`
    if (!message.includes('http')) message = `${message}\n${link}`

    const phoneMasked = phone.length >= 8
      ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
      : '****'

    try {
      await sendSms(phone, message, { reservationId: String(reservationId), notifyType })
    } catch (err) {
      await insertSmsLog(admin, {
        reservation_id: reservationId,
        user_id: userId,
        notify_type: notifyType,
        phone_masked: phoneMasked,
        status: 'failed',
        error_message: maskDigits(err instanceof Error ? err.message : String(err)),
      })
      return { sent: false, reason: 'send_error' }
    }

    await insertSmsLog(admin, {
      reservation_id: reservationId,
      user_id: userId,
      notify_type: notifyType,
      phone_masked: phoneMasked,
      status: 'sent',
    })
    return { sent: true, reason: 'sent' }
  } catch {
    // 조회 오류 등 — 메인 흐름(채팅카드)에 영향 없음
    return { sent: false, reason: 'error' }
  }
}
