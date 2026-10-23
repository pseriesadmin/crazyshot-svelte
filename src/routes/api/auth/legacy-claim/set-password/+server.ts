/**
 * POST /api/auth/legacy-claim/set-password — 기존 회원 인증 직후 본인이 쓸 비밀번호 설정 (2026-10-23)
 *
 * 배경: complete 는 무작위 임시 비밀번호로 계정을 만들고 세션만 발급한다. 고객이 비밀번호를 모른 채 로그아웃하면
 * 다시 로그인할 수 없고, 이어서 "기존 회원 인증"은 "찾을 수 없음", 신규 가입은 "이미 가입" 으로 막히는 결함이 있었다.
 * 이 엔드포인트가 인증 직후 비밀번호를 정하게 한다.
 *
 * 보안:
 *  - 로그인 세션 필수(complete 가 발급한 세션).
 *  - 기존 회원 인증으로 만들어진 계정(legacy_claimed_at)이고 **인증 후 30분 이내**일 때만 허용 — 일반 계정의 비밀번호를
 *    현재 비밀번호 확인 없이 바꾸는 용도로 쓰지 못하게 한다.
 *  - **1회만 설정 가능**(2026-10-23, sp5 SEC-1): 설정이 끝나면 계정 app_metadata 에 표식을 남기고 이후 호출은 403. 설정 성공 시 이 계정의 모든 세션이 끝나므로(다른 기기 로그아웃 효과) 이 브라우저는 새 비밀번호로 다시 로그인해 세션을 되살린다
 *    (인증 직후 30분 안에 세션을 훔친 사람이 비밀번호를 바꿔 계정을 가져가는 것을 막는다).
 *  - 비밀번호 형식: 6~72자, 영문·숫자·특수문자(ASCII)만 — 로그인 화면 입력 표준과 같은 규칙.
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl, getSupabaseAnonKey } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { validateNewPassword } from '$lib/server/legacyClaim'
import type { RequestHandler } from './$types'

const WINDOW_MS = 30 * 60 * 1000

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = validateNewPassword(body?.password)
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: profile } = await admin
    .from('user_profiles')
    .select('legacy_claimed_at')
    .eq('user_id', session.user.id)
    .maybeSingle()
  const claimedAt = (profile as { legacy_claimed_at: string | null } | null)?.legacy_claimed_at
  if (!claimedAt || Date.now() - new Date(claimedAt).getTime() > WINDOW_MS) {
    return json({ ok: false, error: '비밀번호를 설정할 수 있는 시간이 지났어요. 로그인 화면의 "비밀번호 찾기"를 이용해 주세요.' }, { status: 403 })
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(session.user.id)
  if (userErr || !userData?.user) {
    console.error('[legacy-claim/set-password] getUserById error:', userErr?.message)
    return json({ ok: false, error: '비밀번호를 설정하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const meta = (userData?.user?.app_metadata ?? {}) as Record<string, unknown>
  if (meta.legacy_password_set_at) {
    return json({ ok: false, error: '이미 비밀번호를 설정했어요. 바꾸려면 로그인 화면의 "비밀번호 찾기"를 이용해 주세요.' }, { status: 403 })
  }

  const { error } = await admin.auth.admin.updateUserById(session.user.id, {
    password: parsed.value,
    app_metadata: { ...meta, legacy_password_set_at: new Date().toISOString() },
  })
  if (error) {
    console.error('[legacy-claim/set-password] updateUserById error:', error.message)
    return json({ ok: false, error: '비밀번호를 설정하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  // 관리자 API로 비밀번호를 바꾸면 이 계정의 모든 로그인 세션(지금 쓰는 것 포함)이 끝난다(Stage 실측 2026-10-23) —
  // 그래서 다른 기기는 이미 로그아웃된 상태이고, 이 브라우저만 새 비밀번호로 다시 로그인해 세션을 되살린다.
  const email = userData.user.email
  if (email) {
    const supabaseServer = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll: () => cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, { ...(options ?? {}), path: '/' } as Parameters<typeof cookies.set>[2])
          })
        },
      },
    })
    const { error: reLoginErr } = await supabaseServer.auth.signInWithPassword({ email, password: parsed.value })
    if (reLoginErr) console.error('[legacy-claim/set-password] 재로그인 실패:', reLoginErr.message)
    return json({ ok: true, relogin: !reLoginErr })
  }
  // 이메일이 없어 다시 로그인하지 못한 경우
  return json({ ok: true, relogin: false })
}
