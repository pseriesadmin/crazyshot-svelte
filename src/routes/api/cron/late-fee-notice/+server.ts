/**
 * GET /api/cron/late-fee-notice — 연체료 결제 요청 푸시·문자 발송 (Vercel Cron, KST 09:00)
 *
 * 연체 감지(pg_cron auto_detect_late_fees, 매일 KST 00:00)는 순수 SQL이라 채팅 요청카드만 만들고 푸시·문자를 보낼 수 없다.
 * 이 크론이 "요청 알림이 아직 안 나간 미납 연체료"를 선점(claim_late_fees_for_notice, Migration #788)해
 * 푸시 + 문자를 보낸다. 밤중(00:00) 문자를 피하려고 아침 9시에 실행한다.
 *
 * 스케줄: vercel.json crons — "0 0 * * *" (UTC 00:00 = KST 09:00)
 * 인증: CRON_SECRET (미설정이면 무조건 거부)
 * 실패 건: 공용 함수가 false(푸시·문자 모두 실패 또는 고객 조회 실패)를 돌려주거나 예외를 던지면
 *          release_late_fee_notice 로 선점을 되돌려 다음 날 다시 시도한다(결제 전까지 매일 재시도 — 번호·푸시가 없는 고객도 무해하게 반복).
 * 대상 조회(claim) 실패는 HTTP 500 으로 응답해 모니터링에 보이게 한다(배포 순서 오류 등 조용한 실패 방지).
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { notifyLateFeeRequested } from '$lib/server/lateFeeNotify'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 100
const MAX_BATCHES = 5

interface ClaimedLateFee {
  late_fee_id: string
  rsv_id: number
  amount: number
  hours: number
}

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: { lateFeeId: string; error: string }[] = []
  let claimFailed = false

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc('claim_late_fees_for_notice', { p_limit: BATCH_SIZE })
    if (error) {
      errors.push({ lateFeeId: '-', error: `대상 조회 실패: ${error.message}` })
      claimFailed = true
      break
    }
    const rows = (data ?? []) as ClaimedLateFee[]
    if (rows.length === 0) break

    for (const row of rows) {
      processed++
      let delivered = false
      let reason = '푸시·문자 모두 발송하지 못함'
      try {
        delivered = await notifyLateFeeRequested(admin, { lateFeeId: row.late_fee_id, reservationId: row.rsv_id, feeAmount: Number(row.amount) })
      } catch (err) {
        reason = err instanceof Error ? err.message : '알 수 없는 예외'
      }
      if (delivered) {
        succeeded++
        continue
      }
      failed++
      errors.push({ lateFeeId: row.late_fee_id, error: reason })
      try {
        await admin.rpc('release_late_fee_notice', { p_late_fee_id: row.late_fee_id })
      } catch {
        /* 되돌림 실패는 다음 수동 점검 대상 — 이 건만 건너뛴다 */
      }
    }

    // 되돌린 건이 있으면 같은 실행에서 다시 집지 않도록 여기서 멈춘다(다음 날 9시 실행이 다시 시도)
    if (rows.length < BATCH_SIZE || failed > 0) break
  }

  return json({ processed, succeeded, failed, errors }, { status: claimFailed ? 500 : 200 })
}
