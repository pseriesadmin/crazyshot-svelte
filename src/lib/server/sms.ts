import { dev } from '$app/environment'
import { env } from '$env/dynamic/private'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'

// SMS 발송: Solapi SDK (HMAC 서명 인증 — IP 등록 불필요, Vercel 서버리스에 최적)
// env 미설정 시 SMS 미전송 (graceful skip) — api/profile/send-otp에서 이동(2026-08-20,
// 무인보관함 안내 발송과 공유하기 위해 메시지 본문을 인자로 받는 범용 형태로 일반화).
// 2026-09-10: Aligo(IP 화이트리스트 필수) → Solapi(HMAC 인증, IP 제약 없음)로 전면 교체.
export async function sendSms(to: string, message: string): Promise<void> {
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

  const res = await service.send({
    to:   toClean,
    from: fromClean,
    text: message,
  })

  if (res.failedMessageList.length > 0) {
    const first = res.failedMessageList[0]
    throw new Error(`SMS 발송 실패: ${JSON.stringify(first)}`)
  }
}

// 무인보관함 안내 문자 본문 — 크론(/api/cron/locker-guide)과 CMS "시범 발송"이 같은 문구를 쓰도록 한 곳에서 만든다.
export function buildLockerGuideSms(productName: string | null | undefined, password: string): string {
  return `[크레이지샷] ${productName ?? '상품'} 무인보관함 이용 비밀번호: ${password}`
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
}

const SITE_URL = 'https://crazyshot.kr'

function defaultLinkPath(notifyType: string, reservationId: number): string {
  switch (notifyType) {
    case 'return_remind':    return `/account/rental/${reservationId}/history`
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
  try {
    await admin.from('sms_notification_logs').insert(row)
  } catch {
    // 로그 실패는 발송 흐름에 영향 없음
  }
}

export async function sendLifecycleSms(
  admin: SupabaseClient,
  params: SendLifecycleSmsParams,
): Promise<{ sent: boolean; reason: string }> {
  const { phone, userId, notifyType, productName, reservationId, linkOverride, force } = params

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
    let message = msgFn(productName, link)
    if (!message.includes('http')) message = `${message}\n${link}`

    const phoneMasked = phone.length >= 8
      ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
      : '****'

    try {
      await sendSms(phone, message)
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
