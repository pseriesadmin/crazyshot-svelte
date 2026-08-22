import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { sendSms } from '$lib/server/sms'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 50
const MAX_BATCHES = 5 // 최대 250건/실행 — 10분 간격 크론이라 subscription-billing보다 배치 상한을 낮게 유지

interface ClaimedLockerGuide {
  reservation_id: number
  leg: 'pickup' | 'return'
  phone: string | null
  password: string | null
  product_name: string | null
}

// GET /api/cron/locker-guide — Vercel Cron 전용(10분 간격, vercel.json crons 참고).
// 방문대여/방문반납 + 영업외시간(23:00~08:59) 조합 예약 중 수령·반납시각이 1시간 이내로
// 임박한 건을 claim_reservations_due_for_locker_guide로 원자적으로 선점한 뒤, 채팅카드
// (send_rental_chat_notification RPC) + 브라우저 푸시(sendReservationLifecyclePush) +
// 알리고 SMS(sendSms)를 순차 발송한다. pg_net 등 DB→외부HTTP 경로가 이 프로젝트에 없어
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
        const { error: notifyError } = await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: row.reservation_id,
          p_notify_type:    'locker_guide',
        })
        if (notifyError) throw new Error(notifyError.message)

        await sendReservationLifecyclePush(admin, row.reservation_id, 'locker_guide')

        if (row.phone && row.password) {
          await sendSms(
            row.phone,
            `[크레이지샷] ${row.product_name ?? '상품'} 무인보관함 이용 비밀번호: ${row.password}`,
          )
        }

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

  return json({ processed, succeeded, failed, errors })
}
