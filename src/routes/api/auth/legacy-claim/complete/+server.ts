/**
 * POST /api/auth/legacy-claim/complete
 *
 * 레거시 회원 클레임 완료 엔드포인트
 *
 * ⛔ 2026-09-11 재설계(Stephen 지시 — 개인정보보호법 위반 소지 시정): 이전 설계는 CSV
 * 임포트 시점에 이미 auth.users/user_profiles 계정이 만들어져 있었고, 이 엔드포인트는
 * 그 기존 계정에 비밀번호만 설정하는 역할이었다. 지금은 CSV가 legacy_member_staging
 * (실 고객 DB와 완전 격리된 테이블)에만 적재되므로, 실제 auth.users/user_profiles 계정
 * 생성 자체가 이 엔드포인트 — 즉 본인이 이름+전화번호 인증(OTP)을 실제로 완료하는
 * 시점 — 로 이동됐다. 상세 배경: supabase/migrations/20260911100000_489_legacy_member_staging.sql
 *
 * 흐름:
 *   1. verify-otp가 반환한 token(OTP 행 ID) 유효성 재검증
 *   2. OTP 행의 phone에서 find_legacy_member(name+phone)로 스테이징 후보 조회
 *   3. admin.createUser로 신규 계정 생성(임시 비밀번호 포함 — 기존처럼 "선등록 후 비번만
 *      나중에 설정"하는 2단계가 필요 없어짐, 검증된 시점에 곧바로 완성된 계정을 만든다)
 *   4. handle_new_user 트리거가 만든 user_profiles 행에 레거시 필드 UPDATE
 *   5. legacy_member_staging 원본 행 DELETE(개인정보 최소보유 — 실 계정에 이미 반영됐으므로
 *      원본은 완전 삭제, 익명화 보존 아님)
 *   6. supabase.auth.signInWithPassword로 세션 발급 + 쿠키 기록
 *   7. legacy_claim_otps.claimed_at 기록
 *
 * 보안 원칙:
 *   - 임시 비밀번호는 Node.js crypto.randomBytes로 생성, 로그 출력 금지
 *   - 성공 후 같은 token으로 재사용 불가 (claimed_at 설정으로 OTP 행 무효화)
 *   - createUser가 "already been registered"로 충돌하는 경우(부분 실패 복구 시나리오 —
 *     이전 시도가 계정 생성엔 성공했지만 이후 단계에서 실패해 재시도된 경우)를 별도 처리
 */

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl, getSupabaseAnonKey } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'
import { signupRestrictedMessage } from '$lib/server/signupRestriction'
import type { RequestHandler } from './$types'

// 인증번호 확인(verified_at) 후 이 시간 안에 완료해야 한다 — 유출된 token 의 재사용 방지 (2026-10-23, sp5 SEC-4)
const TOKEN_TTL_MS = 15 * 60 * 1000

// 롤백용 계정 삭제 — 실패하면 고아 계정이 남으므로 반드시 로그를 남긴다(수동 정리 대상)
async function rollbackUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) console.error('[legacy-claim/complete] 롤백 계정 삭제 실패(수동 정리 필요):', userId, error.message)
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const name  = typeof body?.name  === 'string' ? body.name.trim()  : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''

  if (!token || !name || !phone) {
    return json({ ok: false, error: '요청 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  // ⛔ 2026-10-23: $env/dynamic/private 에는 PUBLIC_ 접두사 변수가 들어 있지 않다 — 예전에 env.PUBLIC_SUPABASE_ANON_KEY 를 읽어 항상 빈 값이 됐고,
  // 그래서 계정 생성·스테이징 삭제까지 끝낸 뒤 로그인 단계가 매번 실패했다(고객은 계정은 있는데 로그인도 재인증도 못 하는 상태).
  const anonKey        = getSupabaseAnonKey()
  const supabaseUrl    = getSupabaseUrl()

  if (!serviceRoleKey) {
    return json({ ok: false, error: '서버 오류' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // 1. token 유효성 재검증: verified_at IS NOT NULL AND claimed_at IS NULL
  const { data: otpRow } = await admin
    .from('legacy_claim_otps')
    .select('id, phone, verified_at')
    .eq('id', token)
    .not('verified_at', 'is', null)
    .is('claimed_at', null)
    .single()

  if (!otpRow) {
    return json({ ok: false, error: '인증 정보가 유효하지 않습니다. 다시 시도해주세요.' }, { status: 400 })
  }

  const verifiedAtMs = new Date(otpRow.verified_at as string).getTime()
  if (!Number.isFinite(verifiedAtMs) || Date.now() - verifiedAtMs > TOKEN_TTL_MS) {
    return json({ ok: false, error: '인증 시간이 지났어요. 인증번호를 다시 받아 진행해주세요.', code: 'token_expired' }, { status: 400 })
  }

  // OTP에 기록된 전화번호와 요청 전화번호 일치 확인
  if (otpRow.phone !== phone) {
    return json({ ok: false, error: '인증 정보가 유효하지 않습니다.' }, { status: 400 })
  }

  // 2. find_legacy_member로 스테이징 후보 조회
  const { data: member, error: rpcError } = await admin.rpc('find_legacy_member', {
    p_name: name,
    p_phone: phone,
  })

  if (rpcError) {
    console.error('[legacy-claim/complete] find_legacy_member RPC error:', rpcError.message)
    return json({ ok: false, error: '회원 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (!member || !member.staging_id || !member.email) {
    return json({ ok: false, error: '회원 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  // 3. 임시 비밀번호 생성 + 신규 계정 생성 (스코프 내에서만, 절대 로그 출력 금지)
  const tempPassword = randomBytes(32).toString('base64url')
  const { data: authData, error: createErr } = await admin.auth.admin.createUser({
    email: member.email as string,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: member.name },
  })

  if (createErr?.message?.includes('already been registered')) {
    // 부분 실패 복구 시나리오: 이전 claim 시도가 계정 생성엔 성공했지만 이후 단계(스테이징
    // 삭제 등)에서 실패해 재시도된 경우 — 이미 클레임 완료된 계정이면 잔여 스테이징 행을
    // 정리하고 안내, 그 외 상황은 서버 오류로 처리한다.
    const { data: existing } = await admin
      .from('user_profiles')
      .select('legacy_claimed_at')
      .eq('email', member.email as string)
      .maybeSingle()
    if (existing?.legacy_claimed_at) {
      await admin.from('legacy_member_staging').delete().eq('id', member.staging_id as string)
      return json({ ok: false, error: '이미 인증이 완료된 계정입니다. 로그인해주세요.' }, { status: 409 })
    }
    // 같은 이메일로 이미 일반 가입한 계정이 있는 경우 — 계정을 새로 만들 수 없다(2026-10-23: 막연한 서버 오류 대신 안내)
    console.error('[legacy-claim/complete] createUser 충돌(비-클레임 계정):', member.email)
    return json({ ok: false, error: '같은 이메일로 이미 가입된 계정이 있어요. 로그인하거나, 비밀번호가 기억나지 않으면 "비밀번호 찾기"를 이용해 주세요.', code: 'email_registered' }, { status: 409 })
  }

  if (createErr || !authData?.user) {
    const restricted = createErr ? await signupRestrictedMessage(admin, member.email as string, createErr) : null
    if (restricted) return json({ ok: false, error: restricted, code: 'signup_restricted' }, { status: 409 })
    return json({ ok: false, error: '계정 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }

  const userId = authData.user.id
  const claimedAt = new Date().toISOString()

  // 4. handle_new_user() 트리거가 자동 실행 → user_profiles 생성됨 — 레거시 필드 UPDATE
  const { error: updateErr } = await admin
    .from('user_profiles')
    .update({
      full_name: member.name,
      phone: member.phone,
      legacy_source: member.legacy_source,
      legacy_imported_at: member.legacy_imported_at,  // 스테이징 원본 등록시각 — 감사 이력 보존
      legacy_signup_at: member.legacy_signup_at,
      legacy_purchase_count: member.legacy_purchase_count,
      legacy_claimed_at: claimedAt,
      // 이전 서비스 구매금액(참고용) — 옛 대기 행(마이그레이션 전)에는 값이 없을 수 있어 0 으로 처리
      legacy_purchase_amount: typeof member.legacy_purchase_amount === 'number' && member.legacy_purchase_amount > 0 ? member.legacy_purchase_amount : 0,
      // 생년월일은 값이 있을 때만 옮긴다(이 계정은 방금 새로 만든 것이라 기존 입력값이 없다 — 값이 없으면 칸을 건드리지 않음)
      ...(typeof member.birth_date === 'string' && member.birth_date ? { birth_date: member.birth_date } : {}),
      // 회원등급 전원 NONE 고정 — 실데이터 근거 없음(절대금지 항목)
      // membership_grade: 'NONE' ← handle_new_user 기본값 그대로 유지
    } as Record<string, unknown>)
    .eq('user_id', userId)

  if (updateErr) {
    // 방금 생성한 auth 계정은 롤백, 스테이징 행은 보존(재시도 가능하도록)
    await rollbackUser(admin, userId)
    // 전화번호는 한 계정에만 쓸 수 있다 — 이미 다른 계정이 쓰고 있으면(예: 일반 가입 후 인증을 시도) 구체적으로 안내
    if ((updateErr as { code?: string }).code === '23505') {
      return json({ ok: false, error: '이 휴대폰 번호로 이미 가입된 계정이 있어요. 로그인하거나 "비밀번호 찾기"를 이용해 주세요.', code: 'phone_registered' }, { status: 409 })
    }
    return json({ ok: false, error: '계정 설정 중 오류가 발생했습니다.' }, { status: 500 })
  }

  // 이전 서비스 관리자 메모 — 고객 프로필이 아니라 서버 전용 메모 테이블에 보관(CMS 전용). 실패해도 고객 인증은 막지 않는다(로그만 남김)
  let memoSaveFailed = false
  const legacyMemo = typeof member.legacy_memo === 'string' ? member.legacy_memo.trim() : ''
  if (legacyMemo) {
    const { error: noteErr } = await admin.from('legacy_member_notes').insert({
      user_id: userId,
      memo: legacyMemo,
      source: (member.legacy_source as string | null) ?? null,
    })
    if (noteErr) {
      memoSaveFailed = true
      console.error('[legacy-claim/complete][MEMO_SAVE_FAILED] 관리자 메모 보관 실패 — 대기 행을 보존했으니 수동 이전 필요:', member.staging_id, userId, noteErr.message)
    }
  }

  // 6. signInWithPassword로 세션 발급
  //    @supabase/ssr로 쿠키 세션 설정하기 위해 브라우저 클라이언트가 아닌
  //    cookies 핸들러를 가진 server client를 사용
  const supabaseServer = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        cookiesToSet.forEach(({ name: cName, value, options }) => {
          cookies.set(cName, value, { ...(options ?? {}), path: '/' } as Parameters<typeof cookies.set>[2])
        })
      },
    },
  })

  const { data: signInData, error: signInErr } = await supabaseServer.auth.signInWithPassword({
    email: member.email as string,
    password: tempPassword,
  })

  if (signInErr || !signInData.session) {
    // 로그인에 실패하면 방금 만든 계정을 되돌리고 스테이징 행·인증 토큰은 그대로 둔다 — 고객이 같은 화면에서 다시 시도할 수 있다
    // (이전에는 스테이징을 먼저 지워서, 로그인만 실패해도 계정은 있는데 재인증이 "찾을 수 없음"이 되는 상태로 남았다)
    console.error('[legacy-claim/complete] signInWithPassword 실패:', signInErr?.message)
    await rollbackUser(admin, userId)
    return json({ ok: false, error: '로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 })
  }


  // 5. 스테이징 원본 행 정리 — 로그인(6)까지 성공한 뒤에만 한다(개인정보 최소보유 — 실 계정에 이미 반영됐으므로 삭제).
  //    단 관리자 메모 보관이 실패했으면 메모 원본이 이 행에만 남아 있으므로 삭제하지 않고 인증 완료 표시(claimed_at)만 해 다시 인증 대상이 되지 않게 보존한다(수동 복구용)
  if (memoSaveFailed) {
    const { error: keepErr } = await admin.from('legacy_member_staging').update({ claimed_at: claimedAt }).eq('id', member.staging_id as string)
    if (keepErr) console.error('[legacy-claim/complete] staging 행 보존 표시 실패(수동 확인 필요):', member.staging_id, keepErr.message)
  } else {
    const { error: deleteStagingErr } = await admin
      .from('legacy_member_staging')
      .delete()
      .eq('id', member.staging_id as string)
    if (deleteStagingErr) {
      // 계정은 이미 정상 생성됨 — 로그만 남기고 진행(수동 정리 대상으로 추적)
      console.error('[legacy-claim/complete] staging 행 삭제 실패(수동 정리 필요):', member.staging_id, deleteStagingErr.message)
    }
  }

  // 7. claimed_at 기록 (토큰 재사용 차단)
  const { error: claimMarkErr } = await admin.from('legacy_claim_otps')
    .update({ claimed_at: claimedAt })
    .eq('id', token)
  if (claimMarkErr) console.error('[legacy-claim/complete] OTP claimed 기록 실패:', claimMarkErr.message)

  // 반환: 세션 쿠키는 이미 설정됨 — 리다이렉트 대상만 전달
  // grade/points는 스테이징 테이블에 없는 필드(계정이 방금 막 생성됐으므로) — CSV 등록 시
  // "회원등급 전원 NONE 고정" 불변 원칙 + handle_new_user 기본값과 일치하는 값으로 고정
  return json({
    ok: true,
    // 계정은 무작위 임시 비밀번호로 만들어졌다 — 화면이 이어서 본인이 쓸 비밀번호를 정하게 한다(set-password)
    needsPassword: true,
    redirectTo: '/',
    user: {
      email: member.email,
      name: member.name,
      grade: 'NONE',
      signupAt: member.legacy_signup_at ?? null,
      purchaseCount: member.legacy_purchase_count ?? 0,
      points: 0,
    },
  })
}
