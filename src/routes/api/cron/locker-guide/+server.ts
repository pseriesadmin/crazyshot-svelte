import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { sendSms, buildLockerGuideSms } from '$lib/server/sms'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 50
const MAX_BATCHES = 5 // 최대 250건/실행 — 10분 간격 크론이라 subscription-billing보다 배치 상한을 낮게 유지

interface ClaimedLockerGuide {
  reservation_id: number
  leg: 'pickup' | 'return'
  phone: string | null
  password: string | null
  locker_number: string | null
  product_name: string | null
}

// GET /api/cron/locker-guide — Vercel Cron 전용(10분 간격, vercel.json crons 참고).
// 방문·퀵서비스 수령/반납 예약 중(시간대 제한 없음, Migration 674) 수령·반납시각이 1시간 이내로
// 임박한 건을 claim_reservations_due_for_locker_guide로 원자적으로 선점한 뒤, 채팅카드
// (send_rental_chat_notification RPC) + 브라우저 푸시(sendReservationLifecyclePush) +
// Solapi SMS(sendSms)를 순차 발송한다. pg_net 등 DB→외부HTTP 경로가 이 프로젝트에 없어
// (service-operations.md §15와 동일한 구조적 제약) subscription-billing과 같은 앱코드
// 경유 Vercel Cron 패턴을 재사용한다.
export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed) — "시크릿 없으면 전체 허용"은 절대 금지
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: { reservationId: number; leg: string; error: string }[] = []
  // 아무것도 전달하지 못한 건 — 루프가 끝난 뒤에 "발송됨" 표시를 되돌려 다음 크론(10분 뒤)에서 재시도한다.
  // 루프 도중에 되돌리면 같은 실행의 다음 배치가 곧바로 다시 선정해 즉시 반복 시도되므로 끝에서 한 번에 처리한다.
  const toRelease: { reservationId: number; leg: string }[] = []

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_reservations_due_for_locker_guide', {
      p_limit: BATCH_SIZE,
    })

    if (claimError) {
      errors.push({ reservationId: -1, leg: '-', error: claimError.message })
      break
    }

    const claimedRows = (claimed ?? []) as ClaimedLockerGuide[]
    if (claimedRows.length === 0) break

    for (const row of claimedRows) {
      processed++
      // 한 건의 실패(채팅 RPC 오류·SMS 네트워크 예외)가 나머지 배치 처리를 막지 않도록 개별 격리
      try {
        // 비밀번호가 담긴 문자를 가장 먼저 보낸다 — 실패하면 채팅·푸시를 보내지 않고(중복 방지) 이 건을 재시도 대상으로 되돌린다.
        const canSms = !!(row.phone && row.password)
        if (canSms) {
          try {
            await sendSms(row.phone as string, buildLockerGuideSms(row.product_name, row.locker_number, row.password as string))
          } catch (smsErr) {
            toRelease.push({ reservationId: row.reservation_id, leg: row.leg })
            throw smsErr
          }
        }

        const { error: notifyError } = await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: row.reservation_id,
          p_notify_type:    'locker_guide',
        })
        if (notifyError) {
          // 문자가 이미 나갔으면 안내는 전달된 것 — 다시 보내 문자가 중복되지 않게 되돌리지 않는다. 문자 불가(번호 없음) 건만 재시도.
          if (!canSms) toRelease.push({ reservationId: row.reservation_id, leg: row.leg })
          throw new Error(notifyError.message)
        }

        await sendReservationLifecyclePush(admin, row.reservation_id, 'locker_guide', { skipSms: true }) // 비밀번호 포함 자체 SMS가 있어 허브 SMS 제외

        succeeded++
      } catch (err) {
        failed++
        errors.push({
          reservationId: row.reservation_id,
          leg:           row.leg,
          error:         err instanceof Error ? err.message : '알 수 없는 예외',
        })
      }
    }

    if (claimedRows.length < BATCH_SIZE) break // 마지막 배치(더 이상 대상 없음)
  }

  for (const r of toRelease) {
    const { error: relErr } = await admin.rpc('release_locker_guide_claim', { p_reservation_id: r.reservationId, p_leg: r.leg })
    if (relErr) errors.push({ reservationId: r.reservationId, leg: r.leg, error: `재시도 표시 복구 실패: ${relErr.message}` })
  }

  return json({ processed, succeeded, failed, retryScheduled: toRelease.length, errors })
}
