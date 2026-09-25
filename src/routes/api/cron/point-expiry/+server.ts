import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

// GET /api/cron/point-expiry — Vercel Cron 전용(1일 1회, vercel.json crons 참고).
// 유효기간이 지난 포인트 적립분(구독 혜택 등 expires_at이 있는 적립)을 FIFO로 만료 처리한다.
// 정기결제 크론(자정)이 그날의 적립을 먼저 만들 수 있으므로, 그 뒤 시각(새벽 1시)에 실행해
// 같은 날 적립분이 즉시 만료 후보로 잘못 섞이지 않도록 한다(실제 만료 판정은 expires_at
// 기준이라 순서 자체가 정합성에 필수는 아니지만, 운영 관례상 시간차를 둠).
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
    const { data, error } = await admin.rpc('expire_due_points')
    if (error) {
      console.error('[point-expiry]', error.message)
      return json({ error: error.message }, { status: 500 })
    }
    return json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[point-expiry]', message)
    return json({ error: message }, { status: 500 })
  }
}
