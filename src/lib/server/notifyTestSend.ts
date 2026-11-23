// src/lib/server/notifyTestSend.ts
// CMS 푸시알림 설정 '테스트 발송' (2026-11-16, Stephen 지시) — 알림 유형별로 실제 발송 경로(푸시·문자·채팅카드)를 그대로 태워
// CMS 직원 계정 1개에 보낸다. 수신 누락이 있으면 그 경로에 문제가 있다는 확인용이다.
//  · 대상은 호출부(서버 액션)가 'CMS 직원 계정'으로 제한한다 — 일반 고객에게는 보낼 수 없다.
//  · 예약 기준 알림은 그 계정의 가장 최근 예약 1건을 변수 값 출처로 쓴다(예약이 없으면 예약 기준 알림은 건너뜀).
//  · 같은 날 같은 알림의 문자 중복 판정은 force 로 우회한다.
//  · 푸시를 꺼 둔 알림은 실제와 같이 푸시가 건너뛰어진다(문자는 그대로 나간다).
import type { SupabaseClient } from '@supabase/supabase-js'
import { dev } from '$app/environment'
import { CUSTOMER_LIFECYCLE_PUSH_COPY, sendCardSms, sendPushToUser, sendReservationLifecyclePush } from '$lib/server/push'
import { sendSms } from '$lib/server/sms'
import { composeLockerGuideMessage } from '$lib/server/lockerGuideMessage'
import { loadCustomerNameVars, loadReservationCardVars, resolveCardContent, wrapAutoReply } from '$lib/server/cardMessage'
import { UNANSWERED_DEFAULT_MESSAGE } from '$lib/server/unansweredNotice'
import { getNotifyMessageOverride } from '$lib/server/notifyMessages'
import { NOTIFY_SPECS, applyNotifyTemplate, withSmsPrefix, type NotifyVars } from '$lib/utils/notifyTemplate'

export const TEST_SEND_TYPES: string[] = NOTIFY_SPECS.map((s) => s.notifyType)

export interface TestSendOutcome {
  notifyType: string
  push: string
  sms: string
  card: string
}

// 채팅카드를 DB 함수 send_rental_chat_notification 이 만드는 유형
const RPC_CARD_TYPES = new Set([
  'reservation_hold', 'reservation_approval', 'shipment_notify', 'rental_confirm', 'return_registration', 'return_remind',
  'rental_complete', 'reservation_cancelled', 'damage_claimed', 'tracking_notify', 'dhero_place_guide', 'payment_cancelled_reissue',
])
// 채팅카드를 앱이 send_return_notice_card 로 만드는 유형(안내문장 반영은 cardMessage.resolveCardContent)
const NOTICE_CARD_TYPES = new Set([
  'return_notice_courier', 'return_notice_quick_5h', 'return_notice_quick_2h', 'return_notice_quick_1h', 'return_notice_locker',
  'issue_report_request', 'inspection_pass', 'inspection_issue',
])
const LOCKER_TYPES = new Set(['locker_guide', 'locker_return_guide'])

interface DirectDef {
  title: string
  body: string
  link: string
  vars?: NotifyVars
  /** 문자 발송: sms.ts 발송 유형(sendCardSms) */
  smsType?: string
  smsVars?: NotifyVars
  /** 채팅카드 — 실제 발송 지점과 같은 카드 종류·버튼(본문은 안내문장 우선, 없으면 fallback) */
  card?: { payload: Record<string, unknown>; fallback: string }
  /** 대화창 자동응답 메시지(카드가 아닌 텍스트) — 실제 발송 지점과 같은 문장 규칙 */
  chat?: 'unanswered' | 'ai' | 'canned'
}

// 예약을 거치지 않고 푸시를 직접 보내는 유형 — 제목·본문은 실제 호출부의 기본 문구와 같다
const DIRECT: Record<string, DirectDef> = {
  contract_sent: { title: '전자계약이 도착했어요', body: '계약서를 확인하고 서명해주세요.', link: '/account/rental', smsType: 'contract_link', card: { payload: { type: 'contract_link', action_url: '/account/rental', button_label: '전자계약서명' }, fallback: '전자계약을 확인 후 서명을 등록해주세요.' } },
  contract_signed_customer: { title: '전자계약 서명이 완료됐어요', body: '서명이 정상적으로 접수됐어요.', link: '/account/rental', smsType: 'contract_signed', card: { payload: { type: 'contract_signed', action_url: '/account/rental', button_label: '전자계약완료' }, fallback: '전자계약 서명이 완료되었습니다.' } },
  identity_approved: { title: '본인증명이 확인됐어요', body: '본인증명정보가 정상적으로 확인됐어요.', link: '/account/profile?tab=profile', card: { payload: { type: 'identity_approved', action_url: '/account/profile?tab=profile', button_label: '내 정보 확인하기' }, fallback: '고객님 본인증명이 확인되었어요.' } },
  identity_request: { title: '본인증명 등록을 요청드려요', body: '개인정보 메뉴에서 본인증명정보를 등록해주세요.', link: '/account/profile?tab=profile', card: { payload: { type: 'identity_review_request', action_url: '/account/profile?tab=profile', button_label: '본인증명정보 등록' }, fallback: '개인정보 메뉴에서 본인증명정보를 등록해주세요.' } },
  chat_unanswered: { title: '아직 답변을 기다리고 있어요', body: '문의하신 내용에 아직 답변이 없어요. 잠시 후 다시 확인해 주세요.', link: '/', chat: 'unanswered' },
  admin_chat_reply: { title: '상담 답장이 도착했어요', body: '테스트 답변입니다.', link: '/', vars: { 답변내용: '테스트 답변입니다.' } },
  ai_auto_reply: { title: '답변이 도착했어요', body: '테스트 답변입니다.', link: '/', vars: { 답변내용: '테스트 답변입니다.' }, chat: 'ai' },
  canned_auto_reply: { title: '답변이 도착했어요', body: '테스트 답변입니다.', link: '/', vars: { 답변내용: '테스트 답변입니다.' }, chat: 'canned' },
  event_coupon_issued: { title: '쿠폰이 도착했어요 🎁', body: '30% 할인 쿠폰을 받으셨어요! 지금 확인해보세요.', link: '/account/profile?tab=coupon', vars: { 할인내용: '30% 할인' }, card: { payload: { type: 'COUPON_GIFT_CARD', discount_label: '30% 할인', action_url: '/account/profile?tab=coupon' }, fallback: '쿠폰을 보내드렸어요! (30% 할인)' } },
  late_fee_paid: { title: '연체료 결제가 완료됐어요', body: '연체료 12,000원 결제가 정상 처리됐어요.', link: '/account/rental', vars: { 연체료: '12,000원' }, smsType: 'late_fee_paid', smsVars: { 연체료: '12,000원' }, card: { payload: { type: 'late_fee_paid', fee_amount: 12000, action_url: '/account/rental', button_label: '대여 정보 확인' }, fallback: '연체료 결제가 완료됐습니다. (12,000원)' } },
  late_fee_request: { title: '연체료 결제 요청이 도착했어요', body: '연체료 12,000원 결제를 요청드려요. 대여 정보에서 확인해 주세요.', link: '/account/rental', vars: { 연체료: '12,000원' }, smsType: 'late_fee_request', smsVars: { 연체료: '12,000원' } },
}

const SMS_LOG_TYPE: Record<string, string> = { contract_sent: 'contract_link', contract_signed_customer: 'contract_signed' }

async function latestPushStatus(admin: SupabaseClient, userId: string, type: string, since: string): Promise<string> {
  const { data } = await admin
    .from('notification_logs')
    .select('metadata, sent_at')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(1)
  const m = (data?.[0] as { metadata?: { status?: string; reason?: string } | null } | undefined)?.metadata
  if (!data || data.length === 0) return '기록 없음(꺼짐·수신거부 등으로 건너뜀)'
  return m?.reason ? `${m.status ?? '?'}(${m.reason})` : (m?.status ?? '?')
}

async function latestSmsStatus(admin: SupabaseClient, userId: string, type: string, since: string): Promise<string> {
  const { data } = await admin
    .from('sms_notification_logs')
    .select('status, error_message')
    .eq('user_id', userId)
    .eq('notify_type', SMS_LOG_TYPE[type] ?? type)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  const row = data?.[0] as { status?: string; error_message?: string | null } | undefined
  if (!row) return '기록 없음'
  return row.status === 'sent' ? 'sent' : `${row.status}${row.error_message ? `: ${row.error_message.slice(0, 60)}` : ''}`
}

/** 알림 유형 1개를 대상 계정에 실제 경로로 발송한다. 어떤 오류도 던지지 않고 결과를 문자열로 돌려준다. */
export async function sendTestNotice(admin: SupabaseClient, userId: string, notifyType: string): Promise<TestSendOutcome> {
  const out: TestSendOutcome = { notifyType, push: '-', sms: '-', card: '-' }
  const since = new Date(Date.now() - 2000).toISOString()
  try {
    if (!TEST_SEND_TYPES.includes(notifyType)) return { ...out, push: '알 수 없는 알림' }

    const { data: profile } = await admin.from('user_profiles').select('phone, full_name').eq('id', userId).maybeSingle()
    const phone = (profile as { phone?: string | null } | null)?.phone?.trim() || null
    // 변수(예약코드·수령/반납일시)가 채워지도록 예약코드·일정이 있는 가장 최근 예약을 쓴다(초안 예약은 이 값들이 비어 문장이 어색해진다). 없으면 가장 최근 예약.
    const { data: complete } = await admin.from('rental_reservations').select('id').eq('user_id', userId).not('reservation_code', 'is', null).not('start_date', 'is', null).not('end_date', 'is', null).order('id', { ascending: false }).limit(1)
    const { data: anyResv } = (complete?.length ?? 0) > 0 ? { data: complete } : await admin.from('rental_reservations').select('id').eq('user_id', userId).order('id', { ascending: false }).limit(1)
    const rid = (anyResv?.[0] as { id?: number } | undefined)?.id ?? null

    const direct = DIRECT[notifyType]
    if (direct) {
      // 예약 없이 보내는 알림 — 푸시는 실제 함수(CMS 편집 문장·수신 설정 적용), 문자는 해당 유형만
      await sendPushToUser(userId, notifyType, { title: direct.title, body: direct.body, link: direct.link }, { vars: direct.vars })
      out.push = await latestPushStatus(admin, userId, notifyType, since)
      if (direct.smsType) {
        if (rid == null) out.sms = '예약이 없어 문자 건너뜀'
        else {
          await sendCardSms(admin, { userId, reservationId: rid, notifyType: direct.smsType, force: true, link: direct.link, vars: direct.smsVars })
          out.sms = dev ? '개발 환경이라 건너뜀' : await latestSmsStatus(admin, userId, notifyType, since)
        }
      } else if (notifyType === 'identity_request') {
        if (!phone) out.sms = '전화번호 없음'
        else {
          const override = await getNotifyMessageOverride(admin, 'identity_request')
          const text = (override && applyNotifyTemplate(override, (profile as { full_name?: string | null } | null)?.full_name ? { 고객이름: (profile as { full_name: string }).full_name } : {})) || '예약 진행을 위해 본인증명정보를 등록해 주세요.'
          if (dev) out.sms = '개발 환경이라 건너뜀'
          else {
            await sendSms(phone, `${withSmsPrefix(text)}\nhttps://crazyshot.kr/account/profile?tab=profile`, { notifyType: 'identity_request' })
            out.sms = '발송 요청함(로그 없음)'
          }
        }
      } else {
        out.sms = '문자 없는 알림'
      }
      if (direct.card) {
        // 실제 발송 지점과 같은 방식: 안내문장이 있으면 그 문장(변수 치환), 없으면 기본 문구
        const vars = { ...(await loadReservationCardVars(admin, rid)), ...(direct.vars ?? {}) }
        const content = await resolveCardContent(admin, notifyType, vars, direct.card.fallback)
        const { data: sessionId, error: sessErr } = await admin.rpc('find_or_create_general_chat_session', { p_user_id: userId, p_reservation_id: rid })
        if (sessErr || !sessionId) out.card = `실패: ${sessErr?.message ?? '세션 없음'}`
        else {
          const { error: insErr } = await admin.from('chat_messages').insert({
            session_id: sessionId, sender_type: 'admin', message_type: 'action_card', content, action_payload: direct.card.payload, is_read: false,
          })
          out.card = insErr ? `실패: ${insErr.message}` : 'sent'
        }
      } else if (direct.chat) {
        // 대화창 자동응답 메시지 — 실제 발송 지점과 같은 문장(설정 문구 우선, 없으면 기본)
        const text = direct.chat === 'unanswered'
          ? await resolveCardContent(admin, 'chat_unanswered', await loadCustomerNameVars(admin, userId), UNANSWERED_DEFAULT_MESSAGE)
          : await wrapAutoReply(admin, direct.chat === 'ai' ? 'ai_auto_reply' : 'canned_auto_reply', '테스트 답변입니다.', userId)
        const { data: sessionId, error: sessErr } = await admin.rpc('find_or_create_general_chat_session', { p_user_id: userId, p_reservation_id: rid })
        if (sessErr || !sessionId) out.card = `실패: ${sessErr?.message ?? '세션 없음'}`
        else {
          const { error: insErr } = await admin.from('chat_messages').insert({ session_id: sessionId, sender_type: 'ai', content: text, message_type: 'text' })
          out.card = insErr ? `실패: ${insErr.message}` : 'sent(대화 메시지)'
        }
      } else {
        out.card = '카드·대화 메시지 없음(푸시 전용)'
      }
      return out
    }

    // 이하 예약 기준 알림 — 예약 1건이 필요하다
    if (rid == null) return { ...out, push: '예약이 없어 건너뜀', sms: '건너뜀', card: '건너뜀' }

    if (LOCKER_TYPES.has(notifyType)) {
      const leg = notifyType === 'locker_return_guide' ? 'return' : 'pickup'
      const composed = await composeLockerGuideMessage(admin, rid, { lockerNumber: '1', lockerPassword: '*0000', leg })
      if (!composed) return { ...out, push: '안내문장 조립 실패', sms: '건너뜀', card: '건너뜀' }
      if (phone && !dev) {
        try {
          await sendSms(phone, withSmsPrefix(composed))
          out.sms = '발송 요청함(로그 없음)'
        } catch (e) {
          out.sms = `실패: ${e instanceof Error ? e.message.slice(0, 80) : '오류'}`
        }
      } else out.sms = dev ? '개발 환경이라 건너뜀' : '전화번호 없음'
      const { error } = await admin.rpc('send_locker_guide_card', { p_reservation_id: rid, p_content: composed })
      out.card = error ? `실패: ${error.message}` : 'sent'
      await sendReservationLifecyclePush(admin, rid, notifyType, { skipSms: true, bodyOverride: composed })
      out.push = await latestPushStatus(admin, userId, notifyType, since)
      return out
    }

    const pushCopy = CUSTOMER_LIFECYCLE_PUSH_COPY[notifyType]
    if (!pushCopy) return { ...out, push: '푸시 문구 없음', sms: '건너뜀', card: '건너뜀' }

    if (RPC_CARD_TYPES.has(notifyType)) {
      const { error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: rid, p_notify_type: notifyType })
      out.card = error ? `실패: ${error.message}` : 'sent'
    } else if (NOTICE_CARD_TYPES.has(notifyType)) {
      const vars = await loadReservationCardVars(admin, rid)
      const content = await resolveCardContent(admin, notifyType, vars, pushCopy.body(vars.상품명 ?? '상품'))
      const { error } = await admin.rpc('send_return_notice_card', {
        p_reservation_id: rid, p_notify_type: notifyType, p_content: content, p_button_label: '대여 내역 확인', p_action_url: '/account/rental',
      })
      out.card = error ? `실패: ${error.message}` : 'sent'
    } else {
      out.card = '해당 없음'
    }

    await sendReservationLifecyclePush(admin, rid, notifyType, { forceSms: true })
    out.push = await latestPushStatus(admin, userId, notifyType, since)
    out.sms = dev ? '개발 환경이라 건너뜀' : await latestSmsStatus(admin, userId, notifyType, since)
    return out
  } catch (e) {
    return { ...out, push: out.push === '-' ? `오류: ${e instanceof Error ? e.message.slice(0, 80) : '알 수 없음'}` : out.push }
  }
}
