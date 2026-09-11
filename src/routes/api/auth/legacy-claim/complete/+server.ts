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
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const name  = typeof body?.name  === 'string' ? body.name.trim()  : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''

  if (!token || !name || !phone) {
    return json({ ok: false, error: '요청 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey        = env.PUBLIC_SUPABASE_ANON_KEY ?? ''
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
    console.error('[legacy-claim/complete] createUser 충돌(비-클레임 계정):', member.email)
    return json({ ok: false, error: '계정 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }

  if (createErr || !authData?.user) {
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
      // 회원등급 전원 NONE 고정 — 실데이터 근거 없음(절대금지 항목)
      // membership_grade: 'NONE' ← handle_new_user 기본값 그대로 유지
    } as Record<string, unknown>)
    .eq('user_id', userId)

  if (updateErr) {
    // 방금 생성한 auth 계정은 롤백, 스테이징 행은 보존(재시도 가능하도록)
    await admin.auth.admin.deleteUser(userId)
    return json({ ok: false, error: '계정 설정 중 오류가 발생했습니다.' }, { status: 500 })
  }

  // 5. 스테이징 원본 행 삭제 (개인정보 최소보유 — 실 계정에 이미 반영됐으므로 완전 삭제)
  const { error: deleteStagingErr } = await admin
    .from('legacy_member_staging')
    .delete()
    .eq('id', member.staging_id as string)
  if (deleteStagingErr) {
    // 계정은 이미 정상 생성됨 — 로그만 남기고 진행(수동 정리 대상으로 추적)
    console.error('[legacy-claim/complete] staging 행 삭제 실패(수동 정리 필요):', member.staging_id, deleteStagingErr.message)
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
    return json({ ok: false, error: '로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 })
  }

  // 7. claimed_at 기록 (토큰 재사용 차단)
  await admin.from('legacy_claim_otps')
    .update({ claimed_at: claimedAt })
    .eq('id', token)

  // 반환: 세션 쿠키는 이미 설정됨 — 리다이렉트 대상만 전달
  // grade/points는 스테이징 테이블에 없는 필드(계정이 방금 막 생성됐으므로) — CSV 등록 시
  // "회원등급 전원 NONE 고정" 불변 원칙 + handle_new_user 기본값과 일치하는 값으로 고정
  return json({
    ok: true,
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
