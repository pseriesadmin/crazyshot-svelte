// src/lib/server/push.ts
// FCM 푸시알림 서버 발신 허브 — 도메인 코드는 이 모듈을 통해서만 푸시를 발송한다
// (Firebase Admin SDK를 도메인 코드가 직접 호출하지 않도록 하는 단일 허브 원칙)
import { AGENT_REQUEST_KIND_LABEL } from '$lib/server/crazychat/action'
import { FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_FIREBASE_PROJECT_ID, PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import type { Database, NotificationToken, PushNotificationConfig } from '$lib/types/database'
import { callTypedRpc } from '$lib/utils/rpc'
import { sendLifecycleSms } from './sms'
import { filterAdminPushRecipientsByMenu } from '$lib/server/adminPushMenuFilter'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { composeLockerGuideMessage } from '$lib/server/lockerGuideMessage'
import { applyNotifyTemplate, smsTypeToConfigType, type NotifyVars } from '$lib/utils/notifyTemplate'
import { getNotifyMessageOverride, readMessageFromExtraConfig } from '$lib/server/notifyMessages'

export interface PushPayload {
  title: string
  body: string
  link?: string
}

/**
 * sendPushToUser 반환 결과 — 호출부에서 SMS 폴백 등 후속 처리에 활용한다.
 * 기존 호출부는 반환값을 무시해도 동작에 영향 없음(backward compatible).
 */
export type PushDeliveryResult = {
  delivered: boolean
  reason: 'sent' | 'opted_out' | 'disabled' | 'no_token' | 'delivery_failed' | 'error'
}

// 고객 라이프사이클 푸시 기본 문구 — 코드에 고정(기존 send_rental_chat_notification RPC의 CASE 분기와 같은 패턴).
// 2026-10-10부터 관리자가 /cms/set/push 에서 알림별 안내문장을 편집할 수 있다(push_notification_config.extra_config.message,
// Migration #689) — 편집값이 있으면 아래 body 대신 그 문장(변수 치환 후)이 푸시·문자에 쓰이고, 비어 있으면 이 기본 문구를 그대로 쓴다.
// 채팅카드(send_rental_chat_notification)는 DB 고정 문구라 이 편집의 대상이 아니다(service-operations.md §15).
export const CUSTOMER_LIFECYCLE_PUSH_COPY: Record<string, { title: string; body: (productName: string) => string }> = {
  reservation_hold: {
    title: '예약 신청이 접수됐어요',
    body: (p) => `${p} 예약 신청이 접수됐어요. 전자계약서 발송을 기다려주세요.`,
  },
  reservation_approval: {
    title: '예약이 승인됐어요 🎉',
    body: (p) => `${p} 대여가 확정됐어요. 수령 안내를 확인해주세요.`,
  },
  shipment_notify: {
    title: '상품이 반출됐어요',
    body: (p) => `${p}이(가) 발송됐어요.`,
  },
  rental_confirm: {
    title: '대여가 시작됐어요',
    body: (p) => `${p} 수령이 확인되어 대여가 시작됐어요.`,
  },
  return_registration: {
    title: '반납 접수를 진행해주세요',
    body: (p) => `${p} 반납 정보를 등록해주세요.`,
  },
  return_remind: {
    title: '반납일이 다가와요',
    body: (p) => `${p} 반납예정일이 다가와요. 반납 방법을 확인해주세요.`,
  },
  rental_complete: {
    title: '대여가 종료됐어요',
    body: (p) => `${p} 대여가 정상적으로 종료됐어요. 이용해주셔서 감사합니다.`,
  },
  // 2026-08-19 추가(전역 감사로 발견된 공백 보완) — 채팅카드(Migration 288)는 이미 발송되고
  // 있었으나 이 매핑에 엔트리가 없어 sendReservationLifecyclePush가 조용히 no-op하던 3종.
  // hold_expired는 release_reservation_hold()가 순수 SQL(pg_cron) 내부에서만 실행돼 앱코드의
  // 이 함수를 호출할 경로 자체가 없음 — 문구를 채워도 당장 발송되지는 않으며, 별도 아키텍처
  // (Edge Function+pg_net 등) 없이는 해소되지 않는 구조적 한계로 남겨둔다(범위 밖).
  reservation_cancelled: {
    title: '예약이 취소됐어요',
    body: (p) => `${p} 예약이 취소됐어요. 자세한 내용은 채팅을 확인해주세요.`,
  },
  damage_claimed: {
    title: '파손 신고가 접수됐어요',
    body: (p) => `${p} 파손 신고가 접수됐어요. 담당자가 확인 후 안내드릴게요.`,
  },
  hold_expired: {
    title: '예약 신청이 시간 초과됐어요',
    body: (p) => `${p} 예약 신청이 시간 초과로 취소됐어요. 다시 예약해주세요.`,
  },
  // 2026-08-20 추가 — 무인보관함(영업외시간) 1시간 전 안내. Vercel Cron(/api/cron/locker-guide)
  // 앱코드 경유로 발송되므로 hold_expired와 달리 구조적 한계 없이 정상 발송 가능.
  locker_guide: {
    title: '무인보관함 이용 안내',
    body: (p) => `${p} 이용 시간이 영업외시간이라 무인보관함으로 인계돼요. 비밀번호는 채팅에서 확인해주세요.`,
  },
  // 2026-08-25 추가(Migration 347, NOW-FIX-2 §15 동기화): 두발히어로 수령위치 등록 안내.
  // 채팅카드(send_rental_chat_notification 'dhero_place_guide')와 쌍을 이루는 브라우저 푸시.
  // placePageUrl은 외부 URL이라 푸시 알림에서 직접 링크 클릭을 유도할 수 없음 —
  // 채팅으로 이동하도록 안내하는 문구로 대체.
  dhero_place_guide: {
    title: '수령 위치를 등록해 주세요',
    body: (p) => `${p} 두발히어로 배송이 접수됐어요. 채팅에서 수령 위치를 등록해 주세요.`,
  },
  // RSV-B-B4 추가(2026-08-31): 운송장 번호 발송 알림. 채팅카드(send_rental_chat_notification
  // 'tracking_notify' CASE)와 쌍을 이루는 브라우저 푸시 — service-operations.md §15 동기화 원칙.
  tracking_notify: {
    title: '운송장 번호가 등록됐어요',
    body: (p) => `${p} 운송장 번호가 등록됐어요. 채팅에서 배송 정보를 확인해주세요.`,
  },
  // Migration #494: 예약변경 — 결제취소 후 hold 재진입 안내.
  // 채팅카드(send_rental_chat_notification 'payment_cancelled_reissue')와 쌍을 이루는 브라우저 푸시.
  // service-operations.md §15 동기화 원칙.
  payment_cancelled_reissue: {
    title: '예약변경이 진행됩니다',
    body: (p) => `${p} 기존 결제가 취소됐어요. 잠시 후 새 계약서가 발송됩니다.`,
  },
  // 2026-10-17 반납 방식별 단계 알림(Migration #722, 크론 /api/cron/return-notice). 채팅카드는 send_return_notice_card 가 같은 단계 문장을 보낸다.
  return_notice_courier: {
    title: '반납 안내',
    body: (p) => `${p} 반납일이에요. 크레이지배송 반납 방법을 확인하고 반납요청을 등록해 주세요.`,
  },
  return_notice_quick_5h: {
    title: '퀵서비스 반납 안내',
    body: (p) => `${p} 퀵서비스 반납 안내예요. 대여 종료 시간은 매장 도착 기준이에요.`,
  },
  return_notice_quick_2h: {
    title: '반납을 준비해 주세요',
    body: (p) => `${p} 반납 종료 2시간 전이에요. 반납을 준비해 주세요.`,
  },
  return_notice_quick_1h: {
    title: '반납 종료 1시간 전',
    body: (p) => `${p} 반납 종료 1시간 전이에요. 서둘러 반납을 준비해 주세요.`,
  },
  // 반납 검수 결과(2단계, Migration #724) — 검수 승인 시 / 이슈 등록 시. 채팅카드는 inspection.ts 가 같은 문장으로 보낸다.
  // CS 사전 이슈 접수(3단계, Migration #728) — 운영자가 [이슈 사전 접수]를 누르면 증빙 등록 폼 링크와 함께 나간다.
  issue_report_request: {
    title: '증빙 자료를 등록해 주세요',
    body: (p) => `${p} 장비 이상·파손·분실 접수를 위해 사진·영상 등 증빙 자료를 등록해 주세요.`,
  },
  inspection_pass: {
    title: '대여 완료 안내',
    body: (p) => `${p} 검수 결과, 장비 및 구성품에 이상이 없어 대여가 완료되었습니다. 이용해 주셔서 감사합니다.`,
  },
  inspection_issue: {
    title: '검수 결과 안내',
    body: (p) => `${p} 검수 결과, 장비 및 구성품에 이상이 확인되어 추가 확인 후 담당자가 연락드리겠습니다.`,
  },
  return_notice_locker: {
    title: '무인함 반납 안내',
    body: (p) => `${p} 반납 3시간 전이에요. 반납 후 무인함 정보를 입력해 주세요. 종료 시간까지 입력이 없으면 지연 연체 요금이 발생할 수 있어요!`,
  },
}

const CHUNK_SIZE = 500

let firebaseApp: App | null = null

function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp
  const existing = getApps()
  if (existing.length > 0) {
    firebaseApp = existing[0]
    return firebaseApp
  }
  firebaseApp = initializeApp({
    credential: cert({
      projectId: PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  })
  return firebaseApp
}

function getServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

async function logResult(
  supabase: SupabaseClient<Database>,
  userId: string,
  type: string,
  payload: PushPayload,
  status: 'sent' | 'skipped' | 'error',
  reason?: string,
): Promise<void> {
  try {
    await callTypedRpc<string>(supabase, 'log_push_notification', {
      p_user_id: userId,
      p_type: type,
      p_title: payload.title,
      p_body: payload.body,
      p_metadata: reason ? { status, reason } : { status },
    })
  } catch {
    // 로그 기록 실패는 무시 — 발신 자체를 막지 않음
  }
}

// 대상 사용자들에게 실제 발신 + 만료 토큰 정리 + 결과 로깅 (내부 전용)
// 반환값: sentToUserIds(실제 FCM 전달 성공 uid 집합) + hadTokens(토큰 존재 여부)
// hadTokens=false이면 no_token, hadTokens=true&미포함이면 delivery_failed로 구분 가능.
async function dispatch(
  userIds: string[],
  type: string,
  payload: PushPayload,
): Promise<{ sentToUserIds: Set<string>; hadTokens: boolean }> {
  if (userIds.length === 0) return { sentToUserIds: new Set(), hadTokens: false }
  const supabase = getServiceClient()

  const { data: tokenRows, error: tokenError } = await supabase
    .from('notification_tokens')
    .select('user_id, token')
    .in('user_id', userIds)
    .eq('is_active', true)
    .returns<Pick<NotificationToken, 'user_id' | 'token'>[]>()

  if (tokenError || !tokenRows || tokenRows.length === 0) {
    for (const userId of userIds) {
      await logResult(supabase, userId, type, payload, 'skipped', tokenError ? 'token_query_error' : 'no_active_token')
    }
    return { sentToUserIds: new Set(), hadTokens: false }
  }

  const messaging = getMessaging(getFirebaseApp())
  const tokenToUser = new Map(tokenRows.map((row) => [row.token, row.user_id]))
  const allTokens = tokenRows.map((row) => row.token)
  const sentUserIds = new Set<string>()

  for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
    const chunk = allTokens.slice(i, i + CHUNK_SIZE)

    const result = await messaging.sendEachForMulticast({
      tokens: chunk,
      webpush: {
        // Urgency: high — 절전모드·유휴 서비스워커 상황에서도 브라우저 푸시 서비스가
        // 우선 깨워 전달하도록 요청(RFC 8030). 미지정 시 기본값(normal)이라 배터리 절약
        // 상태에서 전달이 지연될 수 있음(2026-09-15 Stephen 실사용 중 6~10초 지연 보고로 추가).
        headers: { Urgency: 'high' },
        notification: { title: payload.title, body: payload.body },
        fcmOptions: payload.link ? { link: payload.link } : undefined,
      },
      data: { link: payload.link ?? '/', notifyType: type },
    })

    const staleTokens: string[] = []
    result.responses.forEach((res, idx) => {
      if (res.success) {
        const uid = tokenToUser.get(chunk[idx])
        if (uid) sentUserIds.add(uid)
        return
      }
      const code = res.error?.code
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        staleTokens.push(chunk[idx])
      }
    })

    if (staleTokens.length > 0) {
      await callTypedRpc(supabase, 'deactivate_push_tokens', { p_tokens: staleTokens })
    }
  }

  for (const userId of sentUserIds) {
    await logResult(supabase, userId, type, payload, 'sent')
  }
  for (const userId of userIds) {
    if (!tokenRows.some((row) => row.user_id === userId)) {
      await logResult(supabase, userId, type, payload, 'skipped', 'no_active_token')
    }
  }

  return { sentToUserIds: sentUserIds, hadTokens: true }
}

/**
 * 고객 1명에게 푸시 발송 — push_notification_config 마스터 스위치 +
 * 고객 opt-in(allow_rental_alert/allow_benefit_alert) 확인 후 발송.
 * 실패해도 절대 throw하지 않음(채팅 알림 발송과 완전히 독립적으로 동작).
 * 반환값(PushDeliveryResult)으로 SMS 폴백 등 후속 처리 가능 — 기존 호출부는 무시해도 됨.
 */
export async function sendPushToUser(
  userId: string,
  notifyType: string,
  payload: PushPayload,
  options?: {
    /** 안내문장 변수값(상품명·답변내용 등). 고객이름은 이 함수가 프로필에서 채운다. */
    vars?: NotifyVars
    /** true면 CMS 편집 문장을 적용하지 않고 payload.body 그대로 발송(같은 설정 키를 쓰지만 문맥이 다른 알림용) */
    noOverride?: boolean
  },
): Promise<PushDeliveryResult> {
  try {
    const supabase = getServiceClient()

    const { data: config } = await supabase
      .from('push_notification_config')
      .select('push_enabled, category, extra_config')
      .eq('notify_type', notifyType)
      .returns<Pick<PushNotificationConfig, 'push_enabled' | 'category' | 'extra_config'>[]>()
      .maybeSingle()

    if (config && config.push_enabled === false) return { delivered: false, reason: 'disabled' }

    const optInColumn = config?.category === 'customer_marketing' ? 'allow_benefit_alert' : 'allow_rental_alert'
    const { data: profile } = await supabase
      .from('user_profiles')
      .select(`${optInColumn}, full_name`)
      .eq('id', userId)
      .returns<Record<string, unknown>[]>()
      .maybeSingle()

    if (profile && profile[optInColumn] === false) return { delivered: false, reason: 'opted_out' }

    // CMS에서 편집한 안내문장 — 치환 결과가 비면 기본 문구로 되돌린다(알림이 빈 본문으로 나가지 않게)
    let finalPayload = payload
    const override = options?.noOverride ? null : readMessageFromExtraConfig(config?.extra_config)
    if (override) {
      const fullName = typeof profile?.full_name === 'string' ? profile.full_name : ''
      const body = applyNotifyTemplate(override, { ...(fullName ? { 고객이름: fullName } : {}), ...options?.vars })
      if (body) finalPayload = { ...payload, body }
    }

    const { sentToUserIds, hadTokens } = await dispatch([userId], notifyType, finalPayload)
    if (sentToUserIds.has(userId)) return { delivered: true, reason: 'sent' }
    return { delivered: false, reason: hadTokens ? 'delivery_failed' : 'no_token' }
  } catch {
    // 발신 허브 오류는 호출부로 전파하지 않음
    return { delivered: false, reason: 'error' }
  }
}

/**
 * 예약 라이프사이클 고객 푸시 — CMS 상태 전환 액션에서 기존 send_rental_chat_notification 호출
 * 직후에 병행 호출한다. 예약 행(user_id·상품명)을 직접 조회하므로 채팅 RPC와 완전히 독립적으로
 * 동작하며, 실패해도 절대 throw하지 않는다(호출부의 채팅 발송 성공 여부에 영향 없음).
 *
 * SMS: 푸시와 무관하게 대상 타입이면 항상 동시 발송(sms.ts sendLifecycleSms). options.skipSms
 * (구 skipSmsFallback 별칭)로 건너뛸 수 있다 — 호출부가 이미 SMS를 직접 보냈거나 묶음 주문에서
 * 대표 1건만 보낼 때 이중 발송 방지용. smsLink/forceSms는 링크 지정·중복판정 우회용.
 */
export async function sendReservationLifecyclePush(
  admin: SupabaseClient,
  reservationId: number,
  notifyType: string,
  options?: { skipSmsFallback?: boolean; skipSms?: boolean; smsLink?: string; forceSms?: boolean; bodyOverride?: string },
): Promise<void> {
  try {
    const copy = CUSTOMER_LIFECYCLE_PUSH_COPY[notifyType]
    if (!copy) return

    const { data: resv } = await admin
      .from('rental_reservations')
      .select('user_id, reservation_code, start_date, end_date, pickup_time, return_time, products!rental_reservations_product_id_fkey(name, parent_product_id)')
      .eq('id', reservationId)
      .single()

    const row = resv as {
      user_id?: string
      reservation_code?: string | null
      start_date?: string | null
      end_date?: string | null
      pickup_time?: string | null
      return_time?: string | null
      products?: { name?: string } | { name?: string }[] | null
    } | null
    if (!row?.user_id) return

    // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-C)
    await applyParentFieldsToRowProducts([row], ['name'], admin)
    const productsField = row.products
    const productName = (Array.isArray(productsField) ? productsField[0]?.name : productsField?.name) ?? '상품'

    const { data: userProfile } = await admin
      .from('user_profiles')
      .select('phone, full_name')
      .eq('id', row.user_id)
      .maybeSingle()
    const profileRow = userProfile as { phone?: string | null; full_name?: string | null } | null

    // 안내문장 변수(CMS 편집 문장용) — 값이 없는 항목은 비워 둔다
    const joinDateTime = (date?: string | null, time?: string | null): string =>
      [date ?? '', time ?? ''].filter(Boolean).join(' ')
    const vars: NotifyVars = {
      상품명: productName,
      ...(profileRow?.full_name ? { 고객이름: profileRow.full_name } : {}),
      ...(row.reservation_code ? { 예약코드: row.reservation_code } : {}),
      ...(row.start_date ? { 수령일시: joinDateTime(row.start_date, row.pickup_time) } : {}),
      ...(row.end_date ? { 반납일시: joinDateTime(row.end_date, row.return_time) } : {}),
    }
    // 무인보관함 이용 안내(2026-10-11): 푸시알림 설정의 공통 안내문장을 정본으로 이 고객 한 명에게만 보낸다.
    // 크론이 이미 조립한 문장(bodyOverride)이 있으면 그대로, 없으면 여기서 조립한다(조립 실패 시 기존 문구).
    let lockerBody: string | undefined
    if (notifyType === 'locker_guide') {
      lockerBody = options?.bodyOverride ?? (await composeLockerGuideMessage(admin, reservationId)) ?? undefined
    }

    await sendPushToUser(
      row.user_id,
      notifyType,
      { title: copy.title, body: lockerBody ?? copy.body(productName), link: '/account/rental' },
      // 무인보관함은 조립 실패(lockerBody 없음) 때도 편집 문장을 적용하지 않는다 — 함번호·비밀번호 변수 없이 치환되면 깨진 문장이 나가기 때문
      { vars, noOverride: notifyType === 'locker_guide' || lockerBody !== undefined },
    )

    // SMS 동시 발송(2026-10-02, Stephen 확정): 푸시 성공 여부와 무관하게 대상 타입이면 항상 SMS도
    // 발송한다. 수신동의(allow_rental_alert)·블랙리스트는 보지 않는다(예약·대여 관련 필수 안내).
    // 제외 조건(번호 없음·탈퇴·비대상 타입·같은 날 중복·dev)은 sendLifecycleSms가 처리한다.
    // options.skipSms(또는 구 skipSmsFallback): 호출부가 이미 SMS를 직접 보냈거나 묶음 주문에서
    // 대표 1건만 SMS를 보낼 때 이중 발송을 막기 위해 건너뛴다.
    if (!options?.skipSms && !options?.skipSmsFallback) {
      const phone = profileRow?.phone
      if (phone) {
        // 무인보관함은 문자를 크론이 따로 보내고(허브는 skipSms) 허브 문자 경로에서는 편집 문장을 쓰지 않는다
        const smsOverride = notifyType === 'locker_guide' ? null : await getNotifyMessageOverride(admin, notifyType)
        const customMessage = smsOverride ? applyNotifyTemplate(smsOverride, vars) || null : null
        await sendLifecycleSms(admin, {
          phone,
          userId: row.user_id,
          notifyType,
          productName,
          reservationId,
          linkOverride: options?.smsLink,
          force: options?.forceSms,
          customMessage,
        })
      }
    }
  } catch {
    // 예약 정보 조회 실패 등 — 호출부(채팅 발송)로 전파하지 않음
  }
}

/**
 * 계약서 카드(contract_link·contract_signed)처럼 sendReservationLifecyclePush를 거치지 않고
 * sendPushToUser를 직접 부르는 지점용 SMS 동시 발송 헬퍼(2026-10-02).
 * 예약에서 상품명·고객 번호를 조회해 sendLifecycleSms를 호출한다. 실패해도 throw하지 않는다.
 */
export async function sendCardSms(
  admin: SupabaseClient,
  params: { userId: string; reservationId: number | null | undefined; notifyType: string; link?: string; force?: boolean },
): Promise<void> {
  try {
    if (params.reservationId == null) return
    const [{ data: profile }, { data: resv }] = await Promise.all([
      admin.from('user_profiles').select('phone, full_name').eq('id', params.userId).maybeSingle(),
      admin
        .from('rental_reservations')
        .select('reservation_code, products!rental_reservations_product_id_fkey(name, parent_product_id)')
        .eq('id', params.reservationId)
        .maybeSingle(),
    ])
    const profileRow = profile as { phone?: string | null; full_name?: string | null } | null
    const phone = profileRow?.phone
    if (!phone) return
    await applyParentFieldsToRowProducts([resv], ['name'], admin)
    const productsField = (resv as { products?: { name?: string } | { name?: string }[] | null } | null)?.products
    const productName = (Array.isArray(productsField) ? productsField[0]?.name : productsField?.name) ?? '상품'
    const reservationCode = (resv as { reservation_code?: string | null } | null)?.reservation_code

    // 계약서 카드는 설정 유형이 문자 유형과 다르다(contract_link→contract_sent 등) — 매핑이 없으면(재공유) 고정 문구 유지
    const configType = smsTypeToConfigType(params.notifyType)
    const smsOverride = configType ? await getNotifyMessageOverride(admin, configType) : null
    const customMessage = smsOverride
      ? applyNotifyTemplate(smsOverride, {
          상품명: productName,
          ...(profileRow?.full_name ? { 고객이름: profileRow.full_name } : {}),
          ...(reservationCode ? { 예약코드: reservationCode } : {}),
        }) || null
      : null

    await sendLifecycleSms(admin, {
      phone,
      userId: params.userId,
      notifyType: params.notifyType,
      productName,
      reservationId: params.reservationId,
      linkOverride: params.link,
      force: params.force,
      customMessage,
    })
  } catch {
    // SMS 보조 발송 실패는 호출부 흐름에 영향 없음
  }
}

/**
 * 관리자 그룹에게 푸시 발송 — get_admin_push_recipients RPC로 대상(cms_role 보유 +
 * 해당 이벤트 admin_notify_* = true)을 조회한 뒤 발송. eventKey: 'new_reservation' |
 * 'contract_signed' | 'payment_completed' | 'new_session'
 */
export async function sendPushToAdmins(eventKey: string, payload: PushPayload): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { data: recipientIds, error } = await callTypedRpc<string[]>(supabase, 'get_admin_push_recipients', {
      p_event_key: eventKey,
    })
    if (error || !recipientIds || recipientIds.length === 0) return
    // 1h: 상담 이벤트는 consulting.chat 메뉴 권한 OFF 계정 제외(조회 실패 시 전원 유지)
    const targets = await filterAdminPushRecipientsByMenu(supabase, eventKey, recipientIds)
    if (targets.length === 0) return
    await dispatch(targets, eventKey, payload)
  } catch {
    // 발신 허브 오류는 호출부로 전파하지 않음
  }
}

/**
 * 결제완료 관리자 푸시 — 3개 결제확정 경로(confirm-mock 임시승인 / 실결제 confirm API /
 * 실결제 success 페이지)에서 공통으로 호출. reservation_code·고객명을 직접 조회하므로 각
 * 호출부는 reservationId·userId·amount만 넘기면 됨. 실패해도 절대 throw하지 않음(결제 확정
 * 처리 자체는 이 함수 호출 이전에 이미 완료된 상태).
 */
export async function sendPaymentCompletedAdminPush(
  admin: SupabaseClient,
  reservationId: number | string,
  userId: string,
  amount: number,
): Promise<void> {
  try {
    const [{ data: resv }, { data: profile }] = await Promise.all([
      admin.from('rental_reservations').select('reservation_code').eq('id', reservationId).maybeSingle(),
      admin.from('user_profiles').select('full_name').eq('id', userId).maybeSingle(),
    ])

    const reservationCode = (resv as { reservation_code?: string } | null)?.reservation_code ?? ''
    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'
    const amountText = amount > 0 ? `${amount.toLocaleString('ko-KR')}원 ` : ''

    await sendPushToAdmins('payment_completed', {
      title: '결제가 완료됐어요',
      body: `${customerName}님이 ${reservationCode ? `${reservationCode} ` : ''}예약 ${amountText}결제를 완료했어요.`,
      link: `/cms/reservation?selected=${reservationId}`,
    })
  } catch {
    // 조회 실패 등 — 결제 확정 자체는 이미 성공 처리된 상태이므로 전파하지 않음
  }
}

/**
 * 신규 상담(채팅) 세션 관리자 푸시 — POST /api/chat/session에서 세션 신규생성/재활성화
 * 직후 호출한다. 고객명을 조회해 메시지에 포함하며, 실패해도 절대 throw하지 않는다
 * (세션 생성 자체는 이 함수 호출 이전에 이미 성공 처리된 상태).
 */
export async function sendNewChatSessionAdminPush(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()

    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'

    await sendPushToAdmins('new_session', {
      title: '새 상담이 시작됐어요',
      body: `${customerName}님이 채팅 상담을 시작했어요.`,
      link: '/cms/chat',
    })
  } catch {
    // 조회 실패 등 — 세션 생성 자체는 이미 성공 처리된 상태이므로 전파하지 않음
  }
}

/**
 * 고객 상담 메시지 도착 관리자 푸시 (2026-10-05) — new_session(새 상담 시작)·urgent(긴급)는 각각 "세션 생성"·"긴급 분류"일 때만
 * 나가서, 이미 열려 있는 세션에 고객이 새로 쓴 문의는 푸시가 없었다. 같은 세션에 최근 10분 이내 메시지(고객·관리자·자동응답 무관)가
 * 하나라도 있으면 "진행 중인 대화"로 보고 보내지 않는다(연타·관리자 응대 중 중복 알림 방지). 기존 new_session 수신 설정을
 * 그대로 재사용한다(별도 마이그레이션 없음). 실패해도 절대 throw하지 않는다(메시지 저장은 이미 성공한 상태).
 */
export async function sendCustomerMessageAdminPush(
  admin: SupabaseClient,
  sessionId: string,
  userId: string,
  messageId: string,
  content: string,
): Promise<void> {
  try {
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: recent } = await admin
      .from('chat_messages')
      .select('id')
      .eq('session_id', sessionId)
      .neq('id', messageId)
      .gte('created_at', since)
      .limit(1)
    if ((recent?.length ?? 0) > 0) return

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()
    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'
    const preview = content.replace(/\s+/g, ' ').trim().slice(0, 40)

    await sendPushToAdmins('new_session', {
      title: '고객 문의가 도착했어요',
      body: `${customerName}님: ${preview}`,
      link: `/cms/chat?session=${sessionId}`,
    })
  } catch {
    // 조회 실패 등 — 채팅 메시지 저장은 이미 완료된 상태이므로 전파하지 않음
  }
}

/**
 * 긴급상담(CS_ESCALATE) 관리자 푸시 — /api/chat/message에서 AI 의도분류 결과가
 * CS_ESCALATE일 때 (캔드매칭 SENSITIVE_CANNED_CATEGORIES 포함) 호출한다.
 * 중복방지(2단계, sp3-qa-agent GATE E 검수로 발견된 공백 보완 — 2026-09-10):
 *   ① admin_id IS NOT NULL — 실제 관리자가 그 세션에 한 번이라도 응답한 적 있으면 영구 스킵
 *   ② urgent_push_sent_at IS NOT NULL — 관리자 미응답 상태에서 이미 1회 발송했으면 스킵
 *      (같은 세션에서 관리자 응답 전까지 고객이 메시지를 여러 번 보내도 최초 1회만 발송)
 * 두 컬럼 모두 이 함수가 매 호출마다 DB에서 직접 조회해 판정한다(호출부의 판단을 신뢰하지
 * 않음 — 단일 진실 공급원). 발송 성공 시 urgent_push_sent_at을 즉시 채워 이후 재호출을 차단.
 * 실패해도 절대 throw하지 않는다(채팅 메시지 발송 자체는 이미 완료된 상태).
 * Migration #481(admin_notify_urgent_chat_message 컬럼 등) + #482(urgent_push_sent_at
 * 컬럼) 적용 필요.
 */
export async function sendUrgentChatAdminPush(
  admin: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  try {
    const { data: sessionRow } = await admin
      .from('chat_sessions')
      .select('admin_id, urgent_push_sent_at')
      .eq('id', sessionId)
      .maybeSingle()

    const row = sessionRow as { admin_id?: string | null; urgent_push_sent_at?: string | null } | null
    if (!row || row.admin_id != null || row.urgent_push_sent_at != null) return

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()

    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'

    await sendPushToAdmins('urgent_chat_message', {
      title: '긴급 상담 메시지가 도착했어요',
      body: `${customerName}님이 상담을 요청했어요.`,
      link: `/cms/chat?session=${sessionId}`,
    })

    await admin
      .from('chat_sessions')
      .update({ urgent_push_sent_at: new Date().toISOString() })
      .eq('id', sessionId)
  } catch {
    // 조회 실패 등 — 채팅 메시지 발송 자체는 이미 성공 처리된 상태이므로 전파하지 않음
  }
}

/**
 * 문자 미도착 의심 관리자 푸시(2026-10-14) — 10분 크론이 솔라피 결과와 발송 로그를 대조해 단말 도착이 확인되지 않은 건을 찾았을 때 호출한다.
 * 한 번 점검에서 찾은 건은 한 통으로 묶어 알린다(첫 건 예약으로 연결). 실패해도 throw하지 않는다(알림 표시는 이미 저장됨).
 */
export async function sendSmsUndeliveredAdminPush(
  items: Array<{ reservationId: number; reservationCode: string; label: string }>,
): Promise<void> {
  try {
    if (items.length === 0) return
    const first = items[0]
    const more = items.length > 1 ? ` 외 ${items.length - 1}건` : ''
    await sendPushToAdmins('sms_undelivered', {
      title: '고객 문자가 도착하지 않은 것으로 보여요',
      body: `${first.reservationCode} ${first.label}${more} 문자가 단말에 도착하지 않았어요. 예약 상세의 알림발송 탭을 확인해 주세요.`,
      link: `/cms/reservation?selected=${first.reservationId}`,
    })
  } catch {
    // 발신 허브 오류는 크론 흐름에 영향 없음
  }
}

/**
 * 크레이지챗 접수 관리자 푸시(2026-10-07, S3) — 에이전트가 고객의 예약 시간 변경·연장 요청을 접수했을 때 호출한다.
 * 관리자 전용 알림이라 chat_messages가 아니라 푸시(+CMS 접수 카드)로만 전달한다(service-operations.md §17).
 * 실패해도 절대 throw하지 않는다(접수 기록은 이미 저장된 상태).
 */
export async function sendCrazychatRequestAdminPush(
  admin: SupabaseClient,
  info: { kind: 'time_change' | 'extend'; userId: string; sessionId: string },
): Promise<void> {
  try {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', info.userId)
      .maybeSingle()
    const customerName = (profile as { full_name?: string } | null)?.full_name ?? '고객'
    await sendPushToAdmins('crazychat_request', {
      title: '크레이지챗이 요청을 접수했어요',
      body: `${customerName}님의 ${AGENT_REQUEST_KIND_LABEL[info.kind]}이 접수됐어요. 확인해 주세요.`,
      link: `/cms/chat?session=${info.sessionId}`,
    })
  } catch {
    // 조회 실패 등 — 접수 기록은 이미 저장된 상태이므로 전파하지 않음
  }
}
