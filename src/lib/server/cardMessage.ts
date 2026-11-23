// src/lib/server/cardMessage.ts
// 채팅카드 본문 — CMS 푸시알림 설정에 등록한 안내문장(커스텀)이 있으면 그 문장(변수 치환), 없으면 기존 고정 문구 (2026-11-16, Stephen 지시)
// 푸시·문자와 같은 정본(push_notification_config.extra_config.message)을 쓴다. 예약 알림 카드 중 DB 함수가 만드는 것은
// Migration #835(private.card_text_override)가 같은 규칙으로 처리하고, 앱이 직접 카드를 만드는 지점은 이 파일을 쓴다.
// 이중 구현 주의: 치환 규칙은 notifyTemplate.ts applyNotifyTemplate ↔ SQL private.apply_notify_template 두 곳이 같아야 한다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { getNotifyMessageOverride } from '$lib/server/notifyMessages'
import { applyNotifyTemplate, type NotifyVars } from '$lib/utils/notifyTemplate'

const MAX_CARD_CHARS = 2000

/**
 * 카드 본문 결정 — 등록한 안내문장이 없거나 치환 결과가 비면 fallback(기존 고정 문구)을 그대로 쓴다.
 * 조회·치환 중 어떤 오류도 던지지 않는다(카드 발송을 막지 않는다).
 */
export async function resolveCardContent(
  admin: SupabaseClient,
  notifyType: string,
  vars: NotifyVars,
  fallback: string,
): Promise<string> {
  try {
    const override = await getNotifyMessageOverride(admin, notifyType)
    if (!override) return fallback
    const text = applyNotifyTemplate(override, vars)
    return text ? text.slice(0, MAX_CARD_CHARS) : fallback
  } catch {
    return fallback
  }
}

const joinDateTime = (date?: string | null, time?: string | null): string => [date ?? '', time ?? ''].filter(Boolean).join(' ')

/**
 * 예약 기준 안내문장 변수(고객이름·상품명·예약코드·수령일시·반납일시) — push.ts sendReservationLifecyclePush 와 같은 값.
 * productName 을 넘기면(묶음 대표 표기 등) 그 값을 상품명으로 쓴다. 조회 실패는 가능한 만큼만 돌려준다.
 */
export async function loadReservationCardVars(
  admin: SupabaseClient,
  reservationId: number | null | undefined,
  productName?: string | null,
): Promise<NotifyVars> {
  const vars: NotifyVars = {}
  const given = productName?.trim()
  if (given) vars.상품명 = given
  if (reservationId == null) return vars
  try {
    const { data } = await admin
      .from('rental_reservations')
      .select('user_id, reservation_code, start_date, end_date, pickup_time, return_time, products!rental_reservations_product_id_fkey(name, parent_product_id)')
      .eq('id', reservationId)
      .maybeSingle()
    const row = data as {
      user_id?: string
      reservation_code?: string | null
      start_date?: string | null
      end_date?: string | null
      pickup_time?: string | null
      return_time?: string | null
      products?: { name?: string } | { name?: string }[] | null
    } | null
    if (!row) return vars
    await applyParentFieldsToRowProducts([row], ['name'], admin)
    const p = row.products
    const dbName = (Array.isArray(p) ? p[0]?.name : p?.name) ?? ''
    if (!vars.상품명 && dbName) vars.상품명 = dbName
    if (row.reservation_code) vars.예약코드 = row.reservation_code
    if (row.start_date) vars.수령일시 = joinDateTime(row.start_date, row.pickup_time)
    if (row.end_date) vars.반납일시 = joinDateTime(row.end_date, row.return_time)
    if (row.user_id) {
      const { data: profile } = await admin.from('user_profiles').select('full_name').eq('id', row.user_id).maybeSingle()
      const name = (profile as { full_name?: string | null } | null)?.full_name
      if (name) vars.고객이름 = name
    }
  } catch {
    /* 변수 조회 실패는 값이 빈 채로 치환된다 */
  }
  return vars
}

const ANSWER_TOKEN = '§§ANSWER§§'
const MAX_WRAPPED_CHARS = 4000

/**
 * 상담 자동응답(AI·빠른답변) 채팅 메시지 본문 — 푸시알림 설정의 안내문장(머리말·꼬리말 포함)이 있으면 그 문장 안에 답변을 넣어 보낸다(2026-11-16).
 * 푸시는 이미 이 문장으로 나가므로, 대화창도 같은 문장이어야 고객이 보는 두 곳이 어긋나지 않는다.
 *  · 안내문장이 없거나 {{답변내용}} 변수가 없으면 답변 원문 그대로(답변이 사라지는 일이 없도록)
 *  · 답변은 줄 정리 없이 원문 그대로 끼워 넣는다(줄 앞뒤 공백·연속 공백 보존)
 *  · 조회·치환 오류, 4000자 초과도 답변 원문
 */
export async function wrapAutoReply(
  admin: SupabaseClient,
  notifyType: string,
  answer: string,
  userId: string | null | undefined,
): Promise<string> {
  try {
    const override = await getNotifyMessageOverride(admin, notifyType)
    if (!override || !/\{\{\s*답변내용\s*\}\}/.test(override)) return answer
    const vars = { ...(await loadCustomerNameVars(admin, userId)), 답변내용: ANSWER_TOKEN }
    const rendered = applyNotifyTemplate(override, vars)
    if (!rendered.includes(ANSWER_TOKEN)) return answer
    const text = rendered.split(ANSWER_TOKEN).join(answer)
    return text.length > MAX_WRAPPED_CHARS ? answer : text
  } catch {
    return answer
  }
}

/** 사용자 기준(예약 없는 알림) 고객이름 변수 */
export async function loadCustomerNameVars(admin: SupabaseClient, userId: string | null | undefined): Promise<NotifyVars> {
  if (!userId) return {}
  try {
    const { data } = await admin.from('user_profiles').select('full_name').eq('id', userId).maybeSingle()
    const name = (data as { full_name?: string | null } | null)?.full_name
    return name ? { 고객이름: name } : {}
  } catch {
    return {}
  }
}
