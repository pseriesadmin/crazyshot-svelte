import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { pickFindableProfile, type FindEmailProfileRow } from '$lib/server/findEmailMatch'
import { normalizePhone, PHONE_RE } from '$lib/server/passwordResetOtp'

// 아이디 찾기 — 이름·휴대폰 입력 직후 "일치 계정 있음/없음"만 알려주는 사전 확인(문자 발송 없음).
// 가입 여부를 알려주는 경로라 요청자(IP) 기준으로 분당 횟수를 제한한다(서버리스 인스턴스별 메모리 — 최선 노력, 근본 제한은 방화벽).
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 10
const hits = new Map<string, number[]>()

function overLimit(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
  return false
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let ip = 'unknown'
  try { ip = getClientAddress() } catch { /* 주소를 못 얻으면 공용 키로 제한 */ }
  if (overLimit(ip)) return json({ ok: false, error: '확인 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })

  let phone: string
  let name: string
  try {
    const body = await request.json() as { phone?: string; name?: string }
    phone = normalizePhone(body.phone)
    name = (typeof body.name === 'string' ? body.name : '').trim()
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }
  if (!PHONE_RE.test(phone) || name.length < 2 || name.length > 50) {
    return json({ ok: false, error: '올바른 요청 값이 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const hyphenated = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, full_name, cms_role, withdrawal_status, email')
    .in('phone', [phone, hyphenated])
    .is('deleted_at', null)
    .limit(2)
  if (error) {
    console.error('[find-email/check] 조회 실패:', error.message)
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const matched = !!pickFindableProfile((data ?? []) as FindEmailProfileRow[], name)
  return json({ ok: true, matched })
}
