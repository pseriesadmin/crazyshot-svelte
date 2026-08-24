import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { syncNationalHolidays } from '$lib/server/holidaySync'
import type { RequestHandler } from './$types'

// GET /api/cron/sync-national-holidays — Vercel Cron 전용(1일 1회, vercel.json crons 참고).
// 공공데이터포털 특일정보 API로 올해+내년 법정공휴일을 동기화해 public_holidays
// (holiday_type='national')에 반영한다. DATA_GO_KR_HOLIDAY_API_KEY 미설정 시에도 500으로
// 죽지 않고 조용히 스킵(fail-soft) — src/lib/server/holidaySync.ts 참고.
export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed) — "시크릿 없으면 전체 허용"은 절대 금지
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  try {
    const result = await syncNationalHolidays(admin, env.DATA_GO_KR_HOLIDAY_API_KEY)
    return json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[sync-national-holidays]', message)
    return json({ error: message }, { status: 500 })
  }
}
