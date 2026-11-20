// src/lib/server/dheroAutoBook.ts
// 두발히어로 송장 자동발행 (2026-11-18, Stephen 승인안) — 크론 /api/cron/dhero-book 이 매일 KST 09:00 에 호출한다.
//
// 대상: 계약완료(confirmed) + 송장 없음 + 수령일(start_date)이 오늘(KST) + 수령 방식의 두발히어로 연동 스위치 켜짐(isDheroIntegrationMethod).
// 처리: 주문(예약코드) 1건 = 접수 1회(createDelivery — 예약코드 이력 조회·취소건 회피 포함) → 접수번호를 형제 전부에 저장 →
//       운송장 안내 → 반출(shipped) 전환 → 반출 알림 1회. 관리자의 [택배 출고 처리]와 같은 결과를 사람 없이 만든다.
// 실패: 해당 주문은 건너뜀(상태 불변)·다른 주문은 계속·관리자(매니저 이상)에게 푸시. 크론은 1일 1회라 같은 날 재시도는 없다(수동 [배송 접수]·[출고 처리]로 처리).
// ⚠ 접수 내용·저장 인자는 cms/reservation/+page.server.ts triggerDheroForTransition 의 shipped 분기와 같다 — 한쪽을 바꾸면 이 파일도 함께 점검(dhero-delivery-api.md §6).
//   의도된 차이: ① 접수 먼저·반출 전환 나중(실패 시 confirmed 유지) ② 운송장 안내가 반출 알림보다 먼저(번호가 저장된 뒤라 반출 알림에 번호가 실린다) ③ 형제 중 confirmed 만 처리 ④ 액션 로그 관리자 없음.
import { createDelivery, DheroApiError, DHERO_STATUS_LABEL } from '$lib/server/dhero'
import { isDheroIntegrationMethod } from '$lib/server/isDheroIntegrationMethod'
import { getReservationForDhero, type DheroReservationInfo } from '$lib/server/getReservationForDhero'
import { listOrderReservationIds, joinProductNames } from '$lib/server/dheroOrderUnits'
import { pickDeliveryMemo } from '$lib/server/dheroMemo'
import { notifyTrackingRegistered } from '$lib/server/notifyTrackingRegistered'
import { sendReservationLifecyclePush, sendPushToManagers } from '$lib/server/push'
import { liveDheroBookings } from '$lib/utils/dheroLabels'
import { kstDateIso } from '$lib/utils/pickupLeadTime'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any }

export interface AutoBookResult {
  todayKst: string
  /** 접수·반출 전환까지 끝낸 주문의 대표 예약 id */
  booked: number[]
  failed: { reservationId: number; message: string }[]
  /** 조회 자체가 실패한 경우의 오류 문구 */
  error?: string
}

/** 한 주문을 접수하고 반출까지 전환한다. 실패는 throw 한다(호출부가 fail-soft 로 모은다). */
async function bookOrder(admin: AdminClient, infos: DheroReservationInfo[]): Promise<void> {
  const primary = infos[0]
  const ids = infos.map((i) => i.reservationId)
  if (!primary.address) throw new Error('배송지 주소가 없어 접수하지 못했습니다.')
  if (!primary.postalCode) throw new Error('배송지 우편번호가 없어 접수하지 못했습니다.')

  const deliveryRes = await createDelivery({
    receiverName:              primary.customerName,
    receiverMobile:            primary.customerPhone,
    receiverAddress:           primary.address,
    receiverAddressDetail:     primary.addressDetail,
    receiverAddressPostalCode: primary.postalCode,
    productName:               joinProductNames(infos.map((i) => i.productName)),
    orderIdFromCorp:           primary.reservationCode ?? String(primary.reservationId),
    memoFromCustomer:          pickDeliveryMemo(primary),
    frontdoorPassword:         primary.frontdoorPassword ?? undefined,
  })

  // 접수번호 저장 — 형제 전부(한 건이라도 실패하면 throw: 접수번호가 이미 두발히어로에 있으므로 수동 처리 시 예약코드로 이어받는다)
  for (const id of ids) {
    const { error } = await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  id,
      p_tracking_number: deliveryRes.bookId,
      p_courier_code:    '두발히어로',
      p_status:          DHERO_STATUS_LABEL[0] ?? '배송접수',
      p_status_code:     0,
      p_dong_group:      deliveryRes.dongGroup ?? null,
      p_meta:            deliveryRes as Record<string, unknown>,
      p_return_book_id:  null,
    })
    if (error) throw new Error(`접수는 됐으나 접수번호 저장에 실패했습니다: ${error.message}`)
  }

  // 반출 전환 — 한 건이라도 못 하면 실패로 본다
  for (const id of ids) {
    const { data, error } = await admin.rpc('update_reservation_status', { p_reservation_id: id, p_new_status: 'shipped' })
    const res = data as { ok?: boolean; error?: string } | null
    if (error || !res?.ok) throw new Error(`접수는 됐으나 반출 전환에 실패했습니다: ${error?.message ?? res?.error ?? '알 수 없음'}`)
    try {
      await admin.rpc('log_rental_action', { p_reservation_id: id, p_action_type: 'shipped', p_admin_id: null, p_note: 'auto_dhero_book' })
    } catch { /* 로그 실패는 무시 */ }
  }

  // 알림 — 주문당 1회, fail-soft. 운송장 안내(번호가 저장된 뒤) → 반출 안내 → 수령위치 안내
  await notifyTrackingRegistered(admin as never, primary.reservationId)
  try {
    await admin.rpc('send_rental_chat_notification', { p_reservation_id: primary.reservationId, p_notify_type: 'shipment_notify' })
  } catch (e) { console.error('[dhero-book] shipment_notify chat fail-soft:', e instanceof Error ? e.message : e) }
  try {
    await sendReservationLifecyclePush(admin as never, primary.reservationId, 'shipment_notify')
  } catch (e) { console.error('[dhero-book] shipment_notify push fail-soft:', e instanceof Error ? e.message : e) }
  if (deliveryRes.placePageUrl) {
    try {
      await admin.rpc('send_rental_chat_notification', { p_reservation_id: primary.reservationId, p_notify_type: 'dhero_place_guide', p_action_url: deliveryRes.placePageUrl })
      await sendReservationLifecyclePush(admin as never, primary.reservationId, 'dhero_place_guide')
    } catch (e) { console.error('[dhero-book] place_guide fail-soft:', e instanceof Error ? e.message : e) }
  }
}

export async function runDheroAutoBook(admin: AdminClient, nowMs: number = Date.now()): Promise<AutoBookResult> {
  const todayKst = kstDateIso(nowMs)
  const result: AutoBookResult = { todayKst, booked: [], failed: [] }

  const { data, error } = await admin
    .from('rental_reservations')
    .select('id, pickup_method')
    .eq('status', 'confirmed')
    .eq('start_date', todayKst)
    .is('tracking_number', null)
  if (error) {
    console.error('[dhero-book] 대상 조회 실패:', error.message)
    result.error = error.message
    return result
  }

  const switchCache = new Map<string, boolean>()
  const handled = new Set<number>()

  for (const row of (data ?? []) as { id: number; pickup_method: string | null }[]) {
    if (handled.has(row.id)) continue
    const method = row.pickup_method ?? ''
    try {
      if (!switchCache.has(method)) switchCache.set(method, await isDheroIntegrationMethod(admin, method))
      if (!switchCache.get(method)) continue

      const orderIds = await listOrderReservationIds(admin, row.id)
      for (const id of orderIds) handled.add(id)
      // 고객이 취소신청한 주문(같은 주문 어느 상품이든 cancel_requested_at 표식)은 자동 접수·출고하지 않는다 — 환불 대기 건이 배송으로 나가는 것을 막는다.
      // 취소대기 배지로 이미 관리자에게 보이므로 실패 푸시 없이 건너뛴다(관리자가 취소를 확인하거나 거절한 뒤 수동 처리).
      // 확인 자체가 실패하면 안전한 쪽(접수 안 함)으로 — 실패로 기록해 관리자에게 알린다(fail-closed)
      const { data: cancelRows, error: cancelErr } = await admin.from('rental_reservations').select('id').in('id', orderIds).not('cancel_requested_at', 'is', null).neq('status', 'cancelled')
      if (cancelErr) throw new Error(`취소신청 여부를 확인하지 못해 자동 접수를 건너뛰었습니다: ${cancelErr.message}`)
      if (((cancelRows ?? []) as unknown[]).length > 0) continue
      const all = (await Promise.all(orderIds.map((id) => getReservationForDhero(admin, id).catch(() => null))))
        .filter((r): r is DheroReservationInfo => r != null)
      // 한 건이라도 못 읽으면 일부만 접수·반출되는 것을 막기 위해 주문 전체를 건너뛴다
      if (all.length !== orderIds.length) throw new Error('같은 주문의 예약 정보를 모두 읽지 못해 자동 접수를 건너뛰었습니다.')
      // 이미 살아 있는 접수가 있으면(취소된 접수는 제외) 다시 접수하지 않는다 — 중복 접수 방지
      // 조회된 행은 송장이 비어 있었는데 같은 주문 다른 상품에 접수번호가 있는 드문 경우 — 조용히 넘기지 않고 실패로 알려 관리자가 확인하게 한다
      if (liveDheroBookings(all).length > 0) throw new Error('같은 주문의 다른 상품에 이미 접수번호가 있어 자동 접수를 건너뛰었습니다. 접수 상태를 확인해 주세요.')
      const units = all.filter((r) => r.status === 'confirmed')
      if (units.length === 0) continue

      await bookOrder(admin, units)
      result.booked.push(units[0].reservationId)
    } catch (e) {
      const message = e instanceof DheroApiError ? `두발히어로 접수 실패: ${e.message}` : e instanceof Error ? e.message : '알 수 없는 오류'
      console.error(`[dhero-book] 예약 ${row.id} 실패(fail-soft):`, message)
      result.failed.push({ reservationId: row.id, message })
    }
  }

  if (result.failed.length > 0) {
    await sendPushToManagers('dhero_auto_book_failed', {
      title: '송장 자동발행 실패',
      body: `오늘 배송 ${result.failed.length}건의 송장 자동발행이 실패했어요. 대여현황에서 직접 [배송 접수]·[출고 처리]해 주세요.${result.failed.some((f) => f.message.startsWith('접수는 됐으나')) ? ' (접수는 됐지만 반출 전환이 안 된 건은 [출고 처리]로 마무리하고, 고객 운송장 안내는 따로 확인해 주세요.)' : ''}`,
      link: '/cms/rentals',
    })
  }
  return result
}
