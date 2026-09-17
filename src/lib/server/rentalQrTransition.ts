// QR 스캔 기반 대여 상태전이 공용 처리 로직.
// src/routes/cms/mobile/qr/[product_id]/+page.server.ts의 processQrAction과
// /api/cms/rental-qr-transition(대여목록카드/RentalDetailPanel 자동 QR 기록)이 동일 로직을 공유한다.
// H-01: 직접 DML 금지 — RPC 경유만 허용.

import { sendReservationLifecyclePush } from '$lib/server/push'
import { awardRentalCompletePoints } from '$lib/server/awardRentalCompletePoints'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'

// QR-CONTENT-1: UUID vs product_code 판별 (qr/[product_id]/+page.server.ts와 동일 정규식)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

// 전이 후 상태 → 채팅 알림 타입 (rental-lifecycle.md AUTO_NOTIFY 매핑)
const AUTO_NOTIFY: Partial<Record<string, string>> = {
  shipped:          'shipment_notify',
  in_use:           'rental_confirm',
  return_requested: 'return_registration',
  returned:         'rental_complete',
}

export interface RentalQrTransitionResult {
  ok: boolean
  message?: string
  newStatus?: string
}

export async function processRentalQrTransition(
  admin: AnyClient,
  params: { reservationId: number; newStatus: string; productId: string; userId: string },
): Promise<RentalQrTransitionResult> {
  const { reservationId, newStatus, productId, userId } = params
  if (!reservationId || !newStatus) return { ok: false, message: '잘못된 요청' }

  const { data: result, error: rpcErr } = await admin.rpc('update_reservation_status', {
    p_reservation_id: reservationId,
    p_new_status: newStatus,
  })
  if (rpcErr) return { ok: false, message: rpcErr.message }
  const res = result as { ok: boolean; error?: string } | null
  if (!res?.ok) return { ok: false, message: res?.error ?? '처리 실패' }

  // 자동 채팅 알림 발송 — 실패해도 메인 처리에 영향 없음
  const notifyType = AUTO_NOTIFY[newStatus]
  if (notifyType) {
    try {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: reservationId,
        p_notify_type: notifyType,
      })
    } catch { /* 알림 실패는 무시 */ }
    // 고객 FCM 푸시 병행 발송 (채팅과 독립 — 실패해도 메인 처리에 영향 없음, 갭#3 수정 2026-08-09)
    await sendReservationLifecyclePush(admin, reservationId, notifyType)
  }

  // QR-3: 대여 액션 로그 기록 — 실패해도 메인 처리에 영향 없음 (fail-soft)
  // log_rental_action은 action_type이 visit_pickup 등 특정 값이 아니면 status 변경 없이
  // rental_action_logs에만 INSERT한다 — update_reservation_status가 이미 처리했으므로 안전.
  // note='qr_scan'으로 QR 경로임을 표시 (수동 경로 note='manual'과 구분)
  try {
    await admin.rpc('log_rental_action', {
      p_reservation_id: reservationId,
      p_action_type:    newStatus,
      p_admin_id:       userId,
      p_note:           'qr_scan',
    })
  } catch { /* 로그 실패는 무시 */ }

  // 대여완료 포인트 자동적립 — returned 전이 시에만, fail-soft(공용 헬퍼가 내부 처리)
  if (newStatus === 'returned') {
    try {
      await awardRentalCompletePoints(admin, reservationId)
    } catch { /* 포인트 적립 실패는 무시 */ }
  }

  // QR-3: 상품 이력 자동 기록 — 실패해도 메인 처리에 영향 없음 (fail-soft)
  // QR-CONTENT-1: productId가 product_code 텍스트(예: "CSCRDSL0010000")일 수 있으므로
  // UUID가 아닌 경우 products 테이블에서 실제 UUID를 조회한 뒤 RPC에 전달한다.
  // QR-CASE-1 준수: .ilike() + escapeLikePattern 사용(year_month='all' 소문자 혼입 대응).
  if (productId) {
    try {
      let resolvedProductId = productId
      if (!UUID_RE.test(productId)) {
        const { data: pRow } = await admin
          .from('products')
          .select('id')
          .ilike('product_code', escapeLikePattern(productId))
          .is('deleted_at', null)
          .maybeSingle()
        resolvedProductId = (pRow as { id: string } | null)?.id ?? ''
      }
      if (resolvedProductId) {
        const today = new Date().toISOString().slice(0, 10)
        const { error: histErr } = await admin.rpc('upsert_product_history_record', {
          p_id: null,
          p_product_id: resolvedProductId,
          p_recorded_date: today,
          p_images: [],
          p_user_id: userId,
        })
        if (histErr) {
          console.warn('[rentalQrTransition] 상품이력 기록 실패:', histErr.message, '| productId:', resolvedProductId)
        }
      }
    } catch (e) {
      console.warn('[rentalQrTransition] 상품이력 기록 오류:', e instanceof Error ? e.message : e)
    }
  }

  return { ok: true, newStatus }
}
