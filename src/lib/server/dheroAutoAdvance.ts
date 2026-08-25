// src/lib/server/dheroAutoAdvance.ts
// 두발히어로 배송완료(statusCode=5) 시 대여 여정 자동 전이
//
// 사용처:
//   1. src/routes/api/cron/dhero-sync/+server.ts — pickup/return leg 배송완료 시
//   2. src/routes/api/cms/reservations/[id]/dhero/+server.ts GET — 수동 새로고침 시
//
// 설계 원칙:
//   - statusCode === 5(배송완료)만 트리거 — 반송(6)/분실(7)은 절대 자동전이 안 함
//   - nextStatus() 로직 자체를 변경하지 않음 — 결과만 재사용
//   - EC-2 경쟁조건 방어: DB 재확인 후 여전히 기대값일 때만 전이
//   - 전체 fail-soft: 내부 오류가 밖으로 throw되지 않음
//   - AUTO_NOTIFY 매핑: 수동 버튼(updateStatus)과 동일한 알림 타입 사용

import { nextStatus } from '$lib/utils/rentalTransition'
import { sendReservationLifecyclePush } from '$lib/server/push'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any; rpc: (...args: any[]) => any }

// updateStatus 액션의 AUTO_NOTIFY 매핑과 동일 (rental-lifecycle.md 자동발송 표 기준)
const AUTO_NOTIFY: Partial<Record<string, string>> = {
  shipped:          'shipment_notify',
  in_use:           'rental_confirm',
  return_requested: 'return_registration',
  returned:         'rental_complete',
}

/**
 * 두발히어로 배송완료(statusCode=5)일 때 예약 여정을 다음 단계로 자동 전이.
 *
 * @param admin         service_role Supabase 클라이언트
 * @param reservationId rental_reservations.id (BIGINT)
 * @param direction     'pickup' = 발송 leg(shipped→in_use) / 'return' = 반납 leg(return_requested→returned)
 * @param statusCode    두발히어로 배송상태 코드 (5=배송완료일 때만 전이)
 * @param pickupMethod  rental_reservations.pickup_method
 * @param returnMethod  rental_reservations.return_method
 * @param currentStatus 현재 알려진 예약 status (EC-2 방어를 위해 DB 재확인 병행)
 */
export async function maybeAutoAdvanceOnDheroDelivered(
  admin: AnySupabaseClient,
  reservationId: number,
  direction: 'pickup' | 'return',
  statusCode: number,
  pickupMethod: string | null,
  returnMethod: string | null,
  currentStatus: string,
): Promise<void> {
  try {
    // 배송완료(5)만 트리거 — 절대금지: 6(반송)/7(분실)은 자동전이 금지
    if (statusCode !== 5) return

    // direction에 따른 기대 currentStatus
    // pickup: shipped → in_use / return: return_requested → returned
    const expectedStatus = direction === 'pickup' ? 'shipped' : 'return_requested'
    if (currentStatus !== expectedStatus) return  // EC-1, EC-3

    // EC-2 경쟁조건 방어: DB에서 현재 status 재확인
    // cron과 수동새로고침이 거의 동시에 실행될 때 한쪽만 실제 전이되도록
    const { data: freshRow } = await admin
      .from('rental_reservations')
      .select('status, pickup_method, return_method')
      .eq('id', reservationId)
      .maybeSingle()

    if (!freshRow) return
    const fr = freshRow as Record<string, unknown>
    if ((fr.status as string) !== expectedStatus) return  // 이미 다른 쪽이 전이함

    // DB 재확인 결과의 최신 method를 우선 사용
    const freshPickup = (fr.pickup_method as string | null) ?? pickupMethod
    const freshReturn = (fr.return_method as string | null) ?? returnMethod

    const newStatus = nextStatus(currentStatus, freshPickup, freshReturn)
    if (!newStatus) return

    // 상태 전이
    const { data: rpcResult, error: rpcError } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     newStatus,
    })

    if (rpcError) {
      console.error(`[dheroAutoAdvance] update_reservation_status 실패 (id=${reservationId}):`, rpcError.message)
      return
    }

    const res = rpcResult as { ok: boolean; error?: string } | null
    if (!res?.ok) {
      // 경쟁조건으로 이미 처리됨 — 조용히 스킵 (에러 아님)
      return
    }

    // AUTO_NOTIFY 채팅알림 + 푸시 (fail-soft — 전이 성공 결과에 영향 없음)
    try {
      const notifyType = AUTO_NOTIFY[newStatus]
      if (notifyType) {
        await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: reservationId,
          p_notify_type:    notifyType,
        })
        await sendReservationLifecyclePush(admin as Parameters<typeof sendReservationLifecyclePush>[0], reservationId, notifyType)
      }
    } catch (notifyErr) {
      console.error(
        `[dheroAutoAdvance] 채팅알림 fail-soft (id=${reservationId}):`,
        notifyErr instanceof Error ? notifyErr.message : notifyErr,
      )
    }
  } catch (outer) {
    // 최상위 fail-soft: 이 함수가 throw하면 호출자(cron/수동새로고침)의 dhero 동기화 자체가 실패함
    console.error(
      `[dheroAutoAdvance] 외부 fail-soft (id=${reservationId}):`,
      outer instanceof Error ? outer.message : outer,
    )
  }
}
