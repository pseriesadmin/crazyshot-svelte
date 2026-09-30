/**
 * GET /api/cron/birthday-points — 생일 축하 포인트 자동적립 (Vercel Cron, KST 09:00)
 *
 * point_earn_rules(event_type='birthday')를 기준으로, 생일이 속한 달(月)에 처음 만나는
 * 날 1회 지급한다(정확한 일자 매칭이 아님 — DB 시드 설명 "생일 당월 자동 지급" 기준).
 * 중복 방지는 award_birthday_points_batch RPC 내부에서 user_id+연도 키로 보장하므로,
 * 이 엔드포인트가 그 달에 매일 실행돼도 실제 지급은 최초 1회만 일어난다.
 *
 * 배치 처리: locker-guide/return-remind Cron과 동일한 BATCH_SIZE×MAX_BATCHES 루프 패턴.
 * award_birthday_points_batch는 "이번 호출에서 실제로 지급된" 행만 반환하므로, 반환 행이
 * BATCH_SIZE보다 적으면(=이번 호출에서 더 지급할 대상이 없으면) 다음 배치 없이 종료한다.
 *
 * 스케줄: vercel.json crons — "0 0 * * *" (UTC 00:00 = KST 09:00, return-remind와 동일)
 * 인증: CRON_SECRET (Vercel Cron은 Authorization: Bearer <secret> 헤더를 자동 전송)
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 100
const MAX_BATCHES = 5 // 최대 500건/실행 — 생일 당월 대상 규모 기준 충분한 안전마진

interface BirthdayAwardResult {
  user_id: string
  amount: number
}

export const GET: RequestHandler = async ({ request }) => {
  // CRON_SECRET 인증 — 미설정 시 무조건 거부(fail-closed)
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  const errors: { error: string }[] = []

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: awarded, error: rpcErr } = await admin.rpc('award_birthday_points_batch', {
      p_limit: BATCH_SIZE,
    })

    if (rpcErr) {
      console.error('[birthday-points]', rpcErr.message)
      errors.push({ error: `지급 처리 실패: ${rpcErr.message}` })
      break
    }

    const rows = (awarded ?? []) as BirthdayAwardResult[]
    processed += rows.length
    if (rows.length < BATCH_SIZE) break // 마지막 배치(더 이상 지급 대상 없음)
  }

  return json({ processed, errors })
}
