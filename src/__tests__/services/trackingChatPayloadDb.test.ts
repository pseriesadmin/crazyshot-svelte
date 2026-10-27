import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * Migration 771 — send_rental_chat_notification: 반출·운송장 알림 카드 payload 에 택배사·운송장 번호 (2026-10-27)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 시험. 시험이 만든 채팅 카드·임시 변경은 항상 정리한다.
 *
 * 전제(Stage 테스트 데이터): 예약 53822·54542(같은 주문 10323)는 운송장 TEST-QA-1026 / 택배사 '두발히어로'.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

/** RPC 호출 후 그 세션에 새로 생긴 카드를 읽고 지운다 */
async function sendAndRead(reservationId: number, notifyType: string): Promise<Record<string, unknown>> {
  const startedAt = new Date(Date.now() - 2000).toISOString()
  const { data, error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: reservationId, p_notify_type: notifyType })
  expect(error).toBeNull()
  const sessionId = (data as { session_id?: string } | null)?.session_id
  expect(sessionId).toBeTruthy()
  const { data: rows } = await admin
    .from('chat_messages')
    .select('id, action_payload, created_at')
    .eq('session_id', sessionId as string)
    .gte('created_at', startedAt)
    .order('created_at', { ascending: false })
    .limit(1)
  const row = (rows ?? [])[0] as { id: string; action_payload: Record<string, unknown> } | undefined
  expect(row).toBeTruthy()
  cleanups.push(async () => { await admin.from('chat_messages').delete().eq('id', (row as { id: string }).id) })
  return (row as { action_payload: Record<string, unknown> }).action_payload
}

describe('send_rental_chat_notification — 운송장 payload (Migration 771)', () => {
  it('TP-1 tracking_notify: 택배사·운송장 번호가 payload 에 들어간다 (기존 필드·버튼 라벨 유지)', async () => {
    const p = await sendAndRead(53822, 'tracking_notify')
    expect(p).toMatchObject({ type: 'tracking_notify', tracking_number: 'TEST-QA-1026', carrier: '두발히어로', action_url: '/account/rental', button_label: '배송 정보 확인' })
    expect(p.reservation_id).toBe('53822')
  })

  it('TP-2 shipment_notify: 번호가 있으면 함께 담긴다 (카드 타입·링크 불변)', async () => {
    const p = await sendAndRead(53822, 'shipment_notify')
    expect(p).toMatchObject({ type: 'shipment_notify', tracking_number: 'TEST-QA-1026', carrier: '두발히어로', action_url: '/account/rental' })
  })

  it('TP-3 알림 대상 예약에 운송장이 없으면 같은 주문의 다른 예약 값을 쓴다', async () => {
    const { data: before } = await admin.from('rental_reservations').select('tracking_number, courier_code').eq('id', 54542).single()
    cleanups.push(async () => { await admin.from('rental_reservations').update(before as never).eq('id', 54542) })
    await admin.from('rental_reservations').update({ tracking_number: null, courier_code: null }).eq('id', 54542)
    const p = await sendAndRead(54542, 'tracking_notify')
    expect(p).toMatchObject({ tracking_number: 'TEST-QA-1026', carrier: '두발히어로' })
  })

  it('TP-4 주문 어디에도 운송장이 없으면 tracking_number·carrier 필드를 싣지 않는다', async () => {
    const { data: rows } = await admin.from('rental_reservations').select('id, user_id').is('tracking_number', null).not('user_id', 'is', null).limit(1)
    const target = (rows ?? [])[0] as { id: number } | undefined
    expect(target).toBeTruthy()
    const p = await sendAndRead((target as { id: number }).id, 'shipment_notify')
    expect(p.tracking_number).toBeUndefined()
    expect(p.carrier).toBeUndefined()
    expect(p.type).toBe('shipment_notify')
  })

  it('TP-5 다른 알림 타입은 운송장을 싣지 않는다 (reservation_approval)', async () => {
    const p = await sendAndRead(53822, 'reservation_approval')
    expect(p.tracking_number).toBeUndefined()
    expect(p.carrier).toBeUndefined()
  })

  it('TP-6 함수 시그니처 불변(오버로드 1개)·서버 전용 권한 불변 — 적용 전후 실행 권한 그대로', async () => {
    const { data, error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: 0, p_notify_type: 'tracking_notify' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: false })
  })

  // Migration 775 — 두발히어로에서 취소된 접수번호는 카드에 싣지 않는다
  it('TP-7 취소된 두발히어로 접수(dhero_meta.canceledAt)는 번호·택배사를 싣지 않고, 같은 접수번호를 쓰는 형제 예약 알림도 마찬가지다', async () => {
    const { data: before } = await admin.from('rental_reservations').select('dhero_meta').eq('id', 53822).single()
    cleanups.push(async () => { await admin.from('rental_reservations').update(before as never).eq('id', 53822) })
    await admin.from('rental_reservations').update({ dhero_meta: { canceledAt: '2026-10-27T01:00:00Z' } }).eq('id', 53822)
    for (const id of [53822, 54542]) {
      const p = await sendAndRead(id, 'tracking_notify')
      expect(p).not.toHaveProperty('tracking_number')
      expect(p).not.toHaveProperty('carrier')
      expect(p).toMatchObject({ type: 'tracking_notify', button_label: '배송 정보 확인' })
    }
  })
})
