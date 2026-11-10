// GET /api/chat/consult-notice — 고객 채팅창에 지금 보여줄 상담 응대시간 안내 문구 (2026-11-10)
// 로그인 불필요(비회원 채팅 포함). 노출 시간대(KST)일 때만 문구를 돌려주고, 시간 설정 자체는 내려보내지 않는다.
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getConsultHours } from '$lib/server/consultHours'
import { activeConsultNotice } from '$lib/utils/consultHours'
import { createRateLimiter } from '$lib/server/simpleRateLimit'

// 같은 접속지에서 1분에 30회까지(채팅창 1분 주기 확인 + 여유). 인스턴스 메모리 기반 최선 노력 제한 — 전역 제한은 Vercel Firewall 몫(simpleRateLimit.ts)
const limiter = createRateLimiter(30, 60_000)

export const GET: RequestHandler = async ({ getClientAddress }) => {
  let ip: string | null
  try { ip = getClientAddress() } catch { ip = null }
  if (!limiter.allow(ip ?? 'unknown')) return json({ message: null }, { status: 429, headers: { 'Cache-Control': 'no-store' } })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ message: null })
  const cfg = await getConsultHours(createClient(getSupabaseUrl(), serviceRoleKey))
  return json({ message: activeConsultNotice(cfg) }, { headers: { 'Cache-Control': 'no-store' } })
}
