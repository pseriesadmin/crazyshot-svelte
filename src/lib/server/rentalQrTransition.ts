// QR 스캔 기반 대여 상태전이 공용 처리 로직.
// src/routes/cms/mobile/qr/[product_id]/+page.server.ts의 processQrAction과
// /api/cms/rental-qr-transition(대여목록카드/RentalDetailPanel 자동 QR 기록)이 동일 로직을 공유한다.
// H-01: 직접 DML 금지 — RPC 경유만 허용.

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
  }

  // QR-3: 상품 이력 자동 기록 — 실패해도 메인 처리에 영향 없음
  if (productId) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      await admin.rpc('upsert_product_history_record', {
        p_id: null,
        p_product_id: productId,
        p_recorded_date: today,
        p_images: [],
        p_user_id: userId,
      })
    } catch { /* 이력 기록 실패는 무시 */ }
  }

  return { ok: true, newStatus }
}
