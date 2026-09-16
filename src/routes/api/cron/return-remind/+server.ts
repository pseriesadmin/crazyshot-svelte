/**
 * GET /api/cron/return-remind — 반납일 당일 반납 예정 알림 (Vercel Cron, KST 09:00)
 *
 * 기존 pg_cron(auto-return-remind, Migration 256)의 채팅카드 단독 발송을 대체.
 * Migration 506으로 pg_cron을 해제하고 이 Vercel Cron이 단독 발송 트리거가 된다.
 *
 * 발송 내역 (순서 고정):
 *   ③ 채팅카드: send_rental_chat_notification RPC ('return_remind')
 *   ④ SMS 직접 발송: sendSms — 전화번호 보유 고객에게 항상 발송 (푸시 실패 여부 무관)
 *   ⑤ 브라우저 푸시: sendReservationLifecyclePush (skipSmsFallback: ④에서 SMS 발송 여부)
 *      → 전화번호가 있어 ④에서 SMS를 이미 보냈으면 skipSmsFallback: true로 폴백 차단
 *      → 전화번호가 없어 ④를 건너뛴 경우 skipSmsFallback: false → 폴백 허용(단, 전화번호
 *         없으면 sendReservationLifecycleSmsFallback 내부도 phone null → 미발송)
 *      고객 1인당 SMS는 정확히 1통 이하 발송 보장.
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
import { sendSms } from '$lib/server/sms'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 100
const MAX_BATCHES = 5 // 최대 500건/실행 — 하루 반납 예약 규모 기준 충분한 안전마진
const RETURN_REMIND_SMS_COPY = (productName: string): string =>
  `[크레이지샷] ${productName} 반납예정일이 오늘입니다. crazyshot.kr에서 반납 방법을 확인해 주세요.`

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
        const productName = row.product_name ?? '상품'

        // ③ 채팅카드 발송 — 이 RPC 성공 후 다음 배치 조회 시 이 예약은 dedup 조건에 걸려 제외됨
        const { error: chatErr } = await admin.rpc('send_rental_chat_notification', {
          p_reservation_id: row.reservation_id,
          p_notify_type:    'return_remind',
        })
        if (chatErr) throw new Error(`채팅카드 발송 실패: ${chatErr.message}`)

        // ④ SMS 직접 발송 — 전화번호 보유 고객에게 항상 발송
        const smsSentDirectly = !!row.phone
        if (row.phone) {
          await sendSms(row.phone, RETURN_REMIND_SMS_COPY(productName))
        }

        // ⑤ 브라우저 푸시 (fail-soft: 내부에서 예외를 catch하므로 여기서 throw 없음)
        // skipSmsFallback: ④에서 이미 SMS를 직접 발송한 경우 push 내부 fallback SMS 중복 발송 방지
        await sendReservationLifecyclePush(admin, row.reservation_id, 'return_remind', {
          skipSmsFallback: smsSentDirectly,
        })

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
