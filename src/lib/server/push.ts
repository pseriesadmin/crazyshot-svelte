// src/lib/server/push.ts
// FCM 푸시알림 서버 발신 허브 — 도메인 코드는 이 모듈을 통해서만 푸시를 발송한다
// (Firebase Admin SDK를 도메인 코드가 직접 호출하지 않도록 하는 단일 허브 원칙)
import { FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_FIREBASE_PROJECT_ID, PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import type { Database, NotificationToken, PushNotificationConfig } from '$lib/types/database'
import { callTypedRpc } from '$lib/utils/rpc'

export interface PushPayload {
  title: string
  body: string
  link?: string
}

// 고객 라이프사이클 푸시 문구 — 기존 send_rental_chat_notification RPC(Migration 150/170/174)의
// CASE 분기와 동일하게 서버 코드에 고정 문구로 보관(채팅 RPC도 SQL 내 하드코딩 방식이라 동일 패턴
// 유지 — 문구를 관리자가 실시간 편집 가능하게 하려면 push_notification_config.extra_config 확장이
// 필요하나 이번 범위 밖, 필요 시 별도 요청)
const CUSTOMER_LIFECYCLE_PUSH_COPY: Record<string, { title: string; body: (productName: string) => string }> = {
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
async function dispatch(userIds: string[], type: string, payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return
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
    return
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
}

/**
 * 고객 1명에게 푸시 발송 — push_notification_config 마스터 스위치 +
 * 고객 opt-in(allow_rental_alert/allow_benefit_alert) 확인 후 발송.
 * 실패해도 절대 throw하지 않음(채팅 알림 발송과 완전히 독립적으로 동작).
 */
export async function sendPushToUser(userId: string, notifyType: string, payload: PushPayload): Promise<void> {
  try {
    const supabase = getServiceClient()

    const { data: config } = await supabase
      .from('push_notification_config')
      .select('push_enabled, category')
      .eq('notify_type', notifyType)
      .returns<Pick<PushNotificationConfig, 'push_enabled' | 'category'>[]>()
      .maybeSingle()

    if (config && config.push_enabled === false) return

    const optInColumn = config?.category === 'customer_marketing' ? 'allow_benefit_alert' : 'allow_rental_alert'
    const { data: profile } = await supabase
      .from('user_profiles')
      .select(optInColumn)
      .eq('id', userId)
      .returns<Record<string, boolean>[]>()
      .maybeSingle()

    if (profile && profile[optInColumn] === false) return

    await dispatch([userId], notifyType, payload)
  } catch {
    // 발신 허브 오류는 호출부로 전파하지 않음
  }
}

/**
 * 예약 라이프사이클 고객 푸시 — CMS 상태 전환 액션에서 기존 send_rental_chat_notification 호출
 * 직후에 병행 호출한다. 예약 행(user_id·상품명)을 직접 조회하므로 채팅 RPC와 완전히 독립적으로
 * 동작하며, 실패해도 절대 throw하지 않는다(호출부의 채팅 발송 성공 여부에 영향 없음).
 */
export async function sendReservationLifecyclePush(
  admin: SupabaseClient,
  reservationId: number,
  notifyType: string,
): Promise<void> {
  try {
    const copy = CUSTOMER_LIFECYCLE_PUSH_COPY[notifyType]
    if (!copy) return

    const { data: resv } = await admin
      .from('rental_reservations')
      .select('user_id, products(name)')
      .eq('id', reservationId)
      .single()

    const row = resv as { user_id?: string; products?: { name?: string } | { name?: string }[] | null } | null
    if (!row?.user_id) return

    const productsField = row.products
    const productName = (Array.isArray(productsField) ? productsField[0]?.name : productsField?.name) ?? '상품'

    await sendPushToUser(row.user_id, notifyType, {
      title: copy.title,
      body: copy.body(productName),
      link: '/account/rental',
    })
  } catch {
    // 예약 정보 조회 실패 등 — 호출부(채팅 발송)로 전파하지 않음
  }
}

/**
 * 관리자 그룹에게 푸시 발송 — get_admin_push_recipients RPC로 대상(cms_role 보유 +
 * 해당 이벤트 admin_notify_* = true)을 조회한 뒤 발송. eventKey: 'new_reservation' |
 * 'contract_signed' | 'payment_completed'
 */
export async function sendPushToAdmins(eventKey: string, payload: PushPayload): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { data: recipientIds, error } = await callTypedRpc<string[]>(supabase, 'get_admin_push_recipients', {
      p_event_key: eventKey,
    })
    if (error || !recipientIds || recipientIds.length === 0) return
    await dispatch(recipientIds, eventKey, payload)
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
