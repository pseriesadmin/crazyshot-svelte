/**
 * GET /api/cron/dhero-book — 두발히어로 송장 자동발행 (Vercel Cron, 매일 KST 09:00 = UTC 00:00)
 *
 * - 오늘(KST) 수령인 배송형 예약(계약완료·송장 없음·두발히어로 연동 켜짐)을 두발히어로에 접수하고 반출 단계로 전환한다.
 * - 실제 처리는 $lib/server/dheroAutoBook 의 runDheroAutoBook — 주문당 1회 접수, 실패는 건너뛰고 관리자 푸시(fail-soft).
 * - CRON_SECRET 필수 (미설정 시 401 fail-closed)
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { runDheroAutoBook } from '$lib/server/dheroAutoBook'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const result = await runDheroAutoBook(admin)
  if (result.error) return json({ error: result.error }, { status: 500 })
  return json({ ok: true, date: result.todayKst, booked: result.booked.length, failed: result.failed.length })
}
