/**
 * GET /api/cron/return-remind — 반납일 당일 반납 예정 알림 (Vercel Cron, KST 09:00)
 *
 * 기존 pg_cron(auto-return-remind, Migration 256)의 채팅카드 단독 발송을 대체.
 * Migration 506으로 pg_cron을 해제하고 이 Vercel Cron이 단독 발송 트리거가 된다.
 *
 * 발송 내역 (순서 고정):
 *   ③ 채팅카드: send_rental_chat_notification RPC ('return_remind')
 *   ④ 브라우저 푸시 + SMS: sendReservationLifecyclePush — 푸시와 SMS를 허브가 함께 발송(같은 안내문장,
 *      CMS 편집값 또는 기본 문구). 같은 날 중복 방지·SMS 로그도 허브가 처리한다(2026-10-10 — 이전엔
 *      이 크론이 별도 문구로 SMS를 직접 보내 푸시 문구와 달랐다).
 *
 * 배치 처리 (Migration 507):
 *   BATCH_SIZE × MAX_BATCHES 다중 배치 루프(locker-guide Cron과 동일 패턴).
 *   ③ 채팅카드 발송 성공 직후 다음 배치를 조회하면, 방금 처리된 건은 RPC 내부의
 *   NOT EXISTS dedup 조건에 걸려 자동으로 제외된다 — claim 선점과 동일한 효과.
 *
 * 스케줄: vercel.json crons — "0 0 * * *" (UTC 00:00 = KST 09:00)
 * 인증: CRON_SECRET (Vercel Cron은 Authorization: Bearer <secret> 헤더를 자동 전송)
 * 대상 조회: get_return_remind_targets(p_limit) RPC (Migration 506+507)
 *   - end_date = 오늘(UTC 기준, UTC 00:00 실행 시 KST 날짜와 일치)
 *   - status IN ('in_use', 'return_requested')
 *   - 오늘 이미 발송된 예약 제외(당일 중복 방지)
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 100
const MAX_BATCHES = 5 // 최대 500건/실행 — 하루 반납 예약 규모 기준 충분한 안전마진

interface ReturnRemindTarget {
  reservation_id: number
  user_id: string
  phone: string | null
  product_name: string | null
}

export const GET: RequestHandler = async ({ request }) => {
  // ① CRON_SECRET 인증 — 미설정 시 무조건 거부(fail-closed)
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: { reservationId: number; error: string }[] = []

  // ② 다중 배치 루프 — locker-guide Cron과 동일한 BATCH_SIZE+MAX_BATCHES 패턴
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: targets, error: targetsErr } = await admin.rpc('get_return_remind_targets', {
      p_limit: BATCH_SIZE,
    })

    if (targetsErr) {
      errors.push({ reservationId: -1, error: `대상 조회 실패: ${targetsErr.message}` })
      break
    }

    const rows = (targets ?? []) as ReturnRemindTarget[]
    if (rows.length === 0) break // 더 이상 미발송 대상 없음 → 루프 종료

    for (const row of rows) {
      processed++
      // 한 건 실패가 나머지 발송을 막지 않도록 개별 격리 (fail-soft)
      try {
        // ③ 채팅카드 발송 — 이 RPC 성공 후 다음 배치 조회 시 이 예약은 dedup 조건에 걸려 제외됨
        const { error: chatErr } = await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: row.reservation_id,
          p_notify_type:    'return_remind',
        })
        if (chatErr) throw new Error(`채팅카드 발송 실패: ${chatErr.message}`)

        // ④ 브라우저 푸시 + SMS (fail-soft: 내부에서 예외를 catch하므로 여기서 throw 없음)
        // SMS도 이 허브가 함께 발송한다(2026-10-10) — 푸시와 같은 안내문장(CMS 편집값 또는 기본 문구)을 쓰도록
        // 이 크론이 별도 문구로 직접 보내던 경로를 없앴다. 같은 날 중복 방지·발송 로그는 허브(sendLifecycleSms)가 처리한다.
        await sendReservationLifecyclePush(admin, row.reservation_id, 'return_remind')

        succeeded++
      } catch (err) {
        failed++
        errors.push({
          reservationId: row.reservation_id,
          error:         err instanceof Error ? err.message : '알 수 없는 예외',
        })
      }
    }

    if (rows.length < BATCH_SIZE) break // 마지막 배치(더 이상 대상 없음)
  }

  return json({ processed, succeeded, failed, errors })
}
