// POST /api/auth/merge-guest-chat — 로그인한 회원 계정으로 비회원(익명) 채팅을 통합한다 (2026-10-27, Stephen 지시: 로그인할 때마다 자동 통합)
// 배경: 이미 있는 회원 계정으로 로그인하면 방금까지 쓰던 비회원 계정이 버려져 그 채팅이 고아로 남았다.
// 보안: 두 가지를 모두 확인한 뒤에만 합친다 — ① 이 요청의 로그인 세션(회원, 익명 아님) ② 본문의 비회원 토큰이 실제로 유효한 익명 계정의 것.
//       비회원 토큰은 로그인 직전에 그 브라우저가 들고 있던 세션이라 두 계정을 같은 사람이 쓰고 있다는 증거가 된다. 임의의 계정 ID를 받지 않는다.
// 실제 이동은 서버 전용 DB 함수 merge_guest_chat_into_member(Migration #776, service_role 전용)가 한 트랜잭션으로 처리하고 되돌릴 수 있게 기록을 남긴다.
// 실패해도 로그인 흐름을 막지 않도록 클라이언트는 결과를 기다리지 않는다(실패는 조용히 무시) — 응답은 항상 ok 여부만 알린다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

const TOKEN_MAX = 4096

export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  if ((session.user as { is_anonymous?: boolean }).is_anonymous === true) {
    return json({ ok: false, error: '회원 로그인 상태에서만 통합할 수 있습니다.' }, { status: 400 })
  }

  let guestToken: string
  try {
    const body = (await request.json()) as { guest_access_token?: unknown }
    guestToken = typeof body.guest_access_token === 'string' ? body.guest_access_token.trim() : ''
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }
  if (!guestToken || guestToken.length > TOKEN_MAX) return json({ ok: false, error: '비회원 정보가 없습니다.' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류입니다.' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 비회원 토큰 검증 — 유효한 익명 계정이어야 하고, 지금 로그인한 회원과 달라야 한다
  const { data: guestData, error: guestErr } = await admin.auth.getUser(guestToken)
  const guest = guestData?.user
  if (guestErr || !guest) return json({ ok: false, error: '비회원 정보를 확인할 수 없습니다.' }, { status: 400 })
  if ((guest as { is_anonymous?: boolean }).is_anonymous !== true) {
    return json({ ok: false, error: '비회원 계정이 아닙니다.' }, { status: 400 })
  }
  if (guest.id === session.user.id) return json({ ok: true, sessions: 0, messages: 0 })

  const { data, error } = await admin.rpc('merge_guest_chat_into_member', { p_guest_id: guest.id, p_member_id: session.user.id } as never)
  if (error) {
    console.error('[merge-guest-chat] 통합 실패:', error.message)
    return json({ ok: false, error: '통합에 실패했습니다.' }, { status: 500 })
  }
  const r = (data ?? {}) as { sessions?: number; messages?: number }
  return json({ ok: true, sessions: r.sessions ?? 0, messages: r.messages ?? 0 })
}
