// 본인증명 등록 요청 — 기존 'identity_request' 대화카드 + 푸시 + SMS (2026-10-15, Stephen 확정)
// 예약 신청 단계에서 본인증명정보를 요구하던 토스트 차단을 없애고(Migration #716), 대신 서버가 이 요청을 보낸다.
//  - 관리자 수동 요청(/api/cms/chat/identity-request/direct-send)과 같은 카드(payload)를 쓴다 → buildIdentityRequestPayload 공용.
//  - 서류 미등록(none)일 때만 요청한다. 승인 대기·승인 완료는 요청하지 않는다(예약 승인 게이트는 CMS 별도 세션).
//  - 24시간 안에 같은 요청 카드가 이미 있으면 다시 보내지 않는다(장바구니 담기·예약신청 연타·반복 시 도배 방지).
//  - 채팅 세션은 반드시 find_or_create_general_chat_session RPC 경유(service-operations.md §11).
//  - CMS(/cms/set/push)에서 편집한 'identity_request' 안내문장이 있으면 카드·푸시·SMS 모두 그 문장을 쓴다(없으면 기본 문구, 2026-10-15).
//  - 푸시·SMS는 fail-soft — 카드 저장에 성공하면 요청은 성공으로 본다(카드 저장 실패 시에는 푸시·SMS도 보내지 않는다).
import { dev } from '$app/environment'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocGateStatus, docLandingKind, type DocGateRow } from '$lib/utils/docApproval'
import { sendPushToUser } from '$lib/server/push'
import { sendSms } from '$lib/server/sms'
import { getNotifyMessageOverride } from '$lib/server/notifyMessages'
import { applyNotifyTemplate, SMS_BRAND_PREFIX } from '$lib/utils/notifyTemplate'

export const IDENTITY_REQUEST_CONTENT = '개인정보 메뉴에서 본인증명정보를 등록 부탁드립니다.'
export const IDENTITY_REQUEST_BUTTON_LABEL = '본인증명 등록요청'
const DEDUPE_HOURS = 24
const SITE_URL = 'https://crazyshot.kr'

export type IdentityDocKind = 'identity' | 'foreign'

/** CTA 랜딩 경로 — 개인정보(account/profile?tab=profile)의 본인증명(또는 외국인증명) 영역으로 바로 진입·스크롤한다. */
export function identityRequestActionUrl(docType: IdentityDocKind): string {
  return `/account/profile?tab=profile&doc=${docType}`
}

export function buildIdentityRequestPayload(docType: IdentityDocKind): Record<string, unknown> {
  return {
    type: 'identity_request',
    doc_type: docType,
    button_label: IDENTITY_REQUEST_BUTTON_LABEL,
    action_url: identityRequestActionUrl(docType),
  }
}

export type IdentityRequestReason =
  | 'sent'
  | 'gate_pending'
  | 'gate_approved'
  | 'recently_requested'
  | 'withdrawn'
  | 'error'

export interface IdentityRequestResult {
  requested: boolean
  reason: IdentityRequestReason
}

interface RequestProfileRow extends DocGateRow {
  full_name?: string | null
  phone?: string | null
  withdrawal_status?: string | null
}

/** SMS 발송 기록을 남길 예약 — 지정값 우선, 없으면 취소·만료를 뺀 가장 최근 예약(예약 상세 '알림발송' 탭이 예약 번호로 기록을 찾기 때문). 예약이 없으면 null(기록 생략). */
async function resolveSmsLogReservationId(admin: SupabaseClient, userId: string, explicit?: number): Promise<number | null> {
  try {
    // 지정 예약은 요청 대상 고객의 예약일 때만 쓴다(다른 고객 예약에 기록이 심기는 것 방지) — 아니면 최근 진행 예약으로 대체
    if (explicit != null) {
      const { data: own } = await admin
        .from('rental_reservations').select('id').eq('id', explicit).eq('user_id', userId).maybeSingle()
      if ((own as { id: number } | null)?.id != null) return explicit
    }
    const { data } = await admin
      .from('rental_reservations')
      .select('id')
      .eq('user_id', userId)
      .not('status', 'in', '(cancelled,expired)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as { id: number } | null)?.id ?? null
  } catch {
    return null
  }
}

/** 문자 발송 결과를 sms_notification_logs에 남긴다(fail-soft — 기록 실패가 요청을 막지 않는다). */
async function logIdentityRequestSms(
  admin: SupabaseClient,
  reservationId: number | null,
  userId: string,
  phone: string,
  status: 'sent' | 'failed',
  errorMessage?: string,
): Promise<void> {
  if (reservationId == null) return
  try {
    const phoneMasked = phone.length >= 8 ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4) : '****'
    const { error } = await admin.from('sms_notification_logs').insert({
      reservation_id: reservationId,
      user_id: userId,
      notify_type: 'identity_request',
      phone_masked: phoneMasked,
      status,
      ...(errorMessage ? { error_message: maskDigits(errorMessage) } : {}),
    })
    if (error) console.error('[identity-request] 문자 발송 기록 저장 실패(fail-soft):', maskDigits(error.message ?? String(error)))
  } catch (e) {
    console.error('[identity-request] 문자 발송 기록 예외(fail-soft):', maskDigits(e instanceof Error ? e.message : String(e)))
  }
}

/** 에러 메시지에 섞일 수 있는 연속 숫자(전화번호 등)를 가려 로그에 남긴다. */
function maskDigits(text: string): string {
  return text.replace(/\d{7,}/g, (m) => '*'.repeat(m.length - 4) + m.slice(-4)).slice(0, 300)
}

export const IDENTITY_REREGISTER_CONTENT = '등록하신 본인증명 서류를 확인하기 어려워요. 개인정보 메뉴에서 다시 등록 부탁드립니다.'
const FORCE_DEDUPE_MINUTES = 5

export interface IdentityRequestOptions {
  /** 관리자 수동 재등록 요청 — 서류 상태(승인대기·승인완료)와 무관하게 보내고, 중복 방지는 5분만 적용한다. */
  force?: boolean
  docType?: IdentityDocKind
  /** 문자 발송 기록(sms_notification_logs, 예약 필수)을 연결할 예약 — 없으면 고객의 가장 최근 진행 예약을 찾는다 */
  reservationId?: number
}

export async function requestIdentityDocRegistration(
  admin: SupabaseClient,
  userId: string,
  opts: IdentityRequestOptions = {},
): Promise<IdentityRequestResult> {
  try {
    const { data } = await admin
      .from('user_profiles')
      .select(
        'full_name, phone, withdrawal_status, identity_doc_url, identity_type, identity_verified_at, identity_approved_at, ' +
          'foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at',
      )
      .eq('user_id', userId)
      .maybeSingle()
    const profile = data as RequestProfileRow | null

    const withdrawal = profile?.withdrawal_status ?? 'none'
    if (withdrawal === 'requested' || withdrawal === 'purged') return { requested: false, reason: 'withdrawn' }

    const force = opts.force === true
    if (!force) {
      const gate = getDocGateStatus(profile)
      if (gate === 'pending') return { requested: false, reason: 'gate_pending' }
      if (gate === 'approved') return { requested: false, reason: 'gate_approved' }
    }

    const docType = opts.docType ?? docLandingKind(profile)

    const { data: sessionId, error: sessionErr } = await admin.rpc('find_or_create_general_chat_session', {
      p_user_id: userId,
      p_reservation_id: null,
    })
    if (sessionErr || !sessionId) {
      console.error('[identity-request] 상담 세션 조회 실패:', sessionErr?.message ?? 'no session')
      return { requested: false, reason: 'error' }
    }
    const sid = sessionId as string

    const since = new Date(Date.now() - (force ? FORCE_DEDUPE_MINUTES * 60_000 : DEDUPE_HOURS * 3600_000)).toISOString()
    const { data: recent } = await admin
      .from('chat_messages')
      .select('id')
      .eq('session_id', sid)
      .eq('action_payload->>type', 'identity_request')
      .gte('created_at', since)
      .limit(1)
    if ((recent?.length ?? 0) > 0) return { requested: false, reason: 'recently_requested' }

    // CMS 편집 안내문장(없으면 기본 문구) — 고객이름 변수만 쓸 수 있다. 치환 결과가 비면 기본 문구로 되돌린다.
    const override = await getNotifyMessageOverride(admin, 'identity_request')
    const customText = override
      ? applyNotifyTemplate(override, profile?.full_name ? { 고객이름: profile.full_name } : {})
      : ''

    const payload = buildIdentityRequestPayload(docType)
    const { error: insertErr } = await admin.from('chat_messages').insert({
      session_id: sid,
      sender_type: 'admin',
      content: customText || (force ? IDENTITY_REREGISTER_CONTENT : IDENTITY_REQUEST_CONTENT),
      message_type: 'action_card',
      action_payload: payload,
      is_read: false,
    })
    if (insertErr) {
      console.error('[identity-request] 카드 저장 실패:', insertErr.message)
      return { requested: false, reason: 'error' }
    }
    await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sid)

    const link = payload.action_url as string

    // 푸시(채팅카드와 별개 경로 — service-operations.md §15) — 실패해도 요청은 성공
    try {
      await sendPushToUser(userId, 'identity_request', {
        title: force ? '본인증명 재등록을 요청드려요' : '본인증명 등록을 요청드려요',
        body: force ? '등록하신 서류를 확인하기 어려워요. 개인정보 메뉴에서 다시 등록해주세요.' : '개인정보 메뉴에서 본인증명정보를 등록해주세요.',
        link,
      })
    } catch (e) {
      console.error('[identity-request] 푸시 발송 실패(fail-soft):', maskDigits(e instanceof Error ? e.message : String(e)))
    }

    // SMS — 개발 환경에서는 실번호로 나가지 않도록 건너뛴다(sendLifecycleSms와 동일 원칙)
    const phone = profile?.phone?.trim()
    if (!dev && phone) {
      try {
        const smsBody = customText
          ? `${SMS_BRAND_PREFIX}${customText}`
          : force
            ? '[크레이지샷] 등록하신 본인증명 서류를 확인하기 어려워 재등록을 부탁드립니다.'
            : '[크레이지샷] 예약 진행을 위해 본인증명정보를 등록해 주세요.'
        const logReservationId = await resolveSmsLogReservationId(admin, userId, opts.reservationId)
        try {
          await sendSms(phone, `${smsBody}\n${SITE_URL}${link}`, {
            ...(logReservationId != null ? { reservationId: String(logReservationId) } : {}),
            notifyType: 'identity_request',
          })
          await logIdentityRequestSms(admin, logReservationId, userId, phone, 'sent')
        } catch (smsErr) {
          await logIdentityRequestSms(admin, logReservationId, userId, phone, 'failed', smsErr instanceof Error ? smsErr.message : String(smsErr))
          throw smsErr
        }
      } catch (e) {
        console.error('[identity-request] SMS 발송 실패(fail-soft):', maskDigits(e instanceof Error ? e.message : String(e)))
      }
    }

    return { requested: true, reason: 'sent' }
  } catch (e) {
    console.error('[identity-request] 요청 처리 오류:', maskDigits(e instanceof Error ? e.message : String(e)))
    return { requested: false, reason: 'error' }
  }
}
