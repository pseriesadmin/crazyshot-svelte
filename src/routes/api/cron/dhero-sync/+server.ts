/**
 * GET /api/cron/dhero-sync — 두발히어로 배송상태 자동 갱신 (Vercel Cron)
 *
 * - vercel.json crons에 등록: 10분 간격 (schedule: "STAR/10 STAR STAR STAR STAR")
 * - 종료상태(배송완료·반송완료·분실완료) 아닌 건 중 tracking_number 있는 예약을 일괄 조회
 * - 두발히어로 API → update_reservation_dhero_shipment RPC로 상태 갱신
 * - 각 건은 개별 try/catch로 fail-soft: 한 건 실패가 나머지에 영향 없음
 * - CRON_SECRET 필수 (미설정 시 401 fail-closed)
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import {
  getDeliveryByBookId,
  isDheroTerminalStatus,
  DHERO_STATUS_LABEL,
} from '$lib/server/dhero'
import { maybeAutoAdvanceOnDheroDelivered } from '$lib/server/dheroAutoAdvance'
import type { RequestHandler } from './$types'

// 두발히어로 종료 상태(배송완료·반송완료·분실완료)에 해당하는 예약 status 값
const TERMINAL_RESERVATION_STATUSES = ['completed', 'returned', 'cancelled', 'damage_claimed']

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 동기화 대상:
  //   1. tracking_number 있는 건 — 발송(pickup) leg
  //   2. dhero_return_book_id 있는 건 — 반납(return) leg (tracking_number 없어도 포함)
  // 종료 status(completed/returned/cancelled/damage_claimed) 아닌 예약만 대상
  const { data: rows, error: fetchErr } = await admin
    .from('rental_reservations')
    .select('id, tracking_number, dhero_return_book_id, dhero_status_code, dhero_dong_group, status, pickup_method, return_method')
    .not('status', 'in', `(${TERMINAL_RESERVATION_STATUSES.map(s => `"${s}"`).join(',')})`)
    .not('tracking_number', 'is', null)  // tracking_number 있는 건만 (발송 leg 기준)

  // dhero_return_book_id만 있고 tracking_number가 없는 건은 별도 조회
  const { data: returnOnlyRows, error: returnFetchErr } = await admin
    .from('rental_reservations')
    .select('id, tracking_number, dhero_return_book_id, dhero_status_code, dhero_dong_group, status, pickup_method, return_method')
    .not('status', 'in', `(${TERMINAL_RESERVATION_STATUSES.map(s => `"${s}"`).join(',')})`)
    .is('tracking_number', null)
    .not('dhero_return_book_id', 'is', null)

  if (fetchErr) {
    console.error('[dhero-sync] fetch error:', fetchErr.message)
    return json({ error: fetchErr.message }, { status: 500 })
  }
  if (returnFetchErr) {
    console.error('[dhero-sync] return-only fetch error:', returnFetchErr.message)
  }

  // 발송 leg 대상: dhero_status_code가 아직 종료 아닌 건
  const pickupTargets = (rows ?? []).filter((r) => {
    const row = r as Record<string, unknown>
    return !isDheroTerminalStatus(row.dhero_status_code as number | null | undefined)
  })

  let synced = 0
  let skipped = 0
  let failed = 0

  // ── 발송(pickup) leg 처리 ───────────────────────────────────────────────
  for (const row of pickupTargets) {
    const r = row as Record<string, unknown>
    const bookId = r.tracking_number as string
    const reservationId = r.id as number
    const currentStatus = r.status as string
    const pickupMethod = r.pickup_method as string | null
    const returnMethod = r.return_method as string | null

    try {
      const status = await getDeliveryByBookId(bookId)

      const { error: rpcErr } = await admin.rpc('update_reservation_dhero_shipment', {
        p_reservation_id:  reservationId,
        p_tracking_number: bookId,
        p_courier_code:    '두발히어로',
        p_status:          DHERO_STATUS_LABEL[status.status] ?? String(status.status),
        p_status_code:     status.status,
        p_dong_group:      r.dhero_dong_group ?? null,
        p_meta:            status as Record<string, unknown>,
        p_return_book_id:  null,
      })

      if (rpcErr) {
        console.error(`[dhero-sync] RPC error for ${reservationId}:`, rpcErr.message)
        failed++
      } else {
        synced++
        // 배송완료(statusCode=5) → 여정 자동 전이 시도 (fail-soft)
        await maybeAutoAdvanceOnDheroDelivered(
          admin,
          reservationId,
          'pickup',
          status.status,
          pickupMethod,
          returnMethod,
          currentStatus,
        )
      }
    } catch (e) {
      console.error(`[dhero-sync] fail-soft for ${reservationId}:`, e instanceof Error ? e.message : e)
      failed++
    }
  }

  // ── 반납(return) leg 처리 ────────────────────────────────────────────────
  // dhero_return_book_id가 있는 예약에 대해 반납 배송상태 조회 + 자동전이
  // (tracking_number 있는 예약 중에도 dhero_return_book_id가 채워진 건이 있으면 함께 처리)
  const allRows = [
    ...(rows ?? []).filter((r) => (r as Record<string, unknown>).dhero_return_book_id),
    ...(returnOnlyRows ?? []),
  ]

  for (const row of allRows) {
    const r = row as Record<string, unknown>
    const returnBookId = r.dhero_return_book_id as string
    const reservationId = r.id as number
    const currentStatus = r.status as string
    const pickupMethod = r.pickup_method as string | null
    const returnMethod = r.return_method as string | null

    try {
      const returnStatus = await getDeliveryByBookId(returnBookId)

      // 반납 leg 상태도 RPC로 갱신 (p_return_book_id에 저장)
      await admin.rpc('update_reservation_dhero_shipment', {
        p_reservation_id:  reservationId,
        p_tracking_number: r.tracking_number as string | null ?? returnBookId,
        p_courier_code:    '두발히어로',
        p_status:          DHERO_STATUS_LABEL[returnStatus.status] ?? String(returnStatus.status),
        p_status_code:     returnStatus.status,
        p_dong_group:      r.dhero_dong_group as string | null ?? null,
        p_meta:            returnStatus as Record<string, unknown>,
        p_return_book_id:  returnBookId,
      })

      // 배송완료(5) → 반납 여정 자동 전이 시도 (fail-soft)
      await maybeAutoAdvanceOnDheroDelivered(
        admin,
        reservationId,
        'return',
        returnStatus.status,
        pickupMethod,
        returnMethod,
        currentStatus,
      )
    } catch (e) {
      console.error(`[dhero-sync] return leg fail-soft for ${reservationId}:`, e instanceof Error ? e.message : e)
    }
  }

  return json({
    ok: true,
    total: pickupTargets.length,
    synced,
    skipped,
    failed,
    timestamp: new Date().toISOString(),
  })
}
