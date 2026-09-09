import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * CMS 전역 전수검증(2026-09-09) — admin_invite_tokens RLS 하이재킹 방지 TDD 통합테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * 결함: admin_invite_tokens의 RLS 정책(`admin_manage_tokens`)이
 *   `cms_role IS NOT NULL`(등급 무관)이면 FOR ALL(SELECT/INSERT/UPDATE/DELETE)을 전부
 *   허용한다 — partner(최하위) 등급도 아직 비밀번호를 설정하지 않은 신규 관리자
 *   (superadmin 포함) 초대 토큰을 그대로 조회·수정·삭제할 수 있다. 유출된 token으로
 *   /cms/login?invite=<token> → setPassword 액션(세션·권한 체크 없음, 토큰 유효성만
 *   확인)을 먼저 호출하면 그 계정을 탈취할 수 있다.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다 (accountWithdrawalPhone.test.ts / couponLazySequencing.test.ts와 동일 패턴).
 *
 * GREEN 목표: 신규 마이그레이션으로 admin_manage_tokens 정책을 service_role 전용
 *   (`FOR ALL USING (false)`, cms_login_otps와 동일 패턴)으로 교체.
 *   앱 코드(cms/login, cms/accounts)는 이미 전부 service_role 클라이언트로만 이 테이블을
 *   다루므로 회귀 없음 — 이 테스트도 service_role 경로는 항상 통과함을 함께 검증한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralPartnerSession(): Promise<{
  client: SupabaseClient
  userId: string
}> {
  const email = `tdd-invrls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral partner 생성 실패: ${error?.message}`)
  const userId = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })

  const { error: roleErr } = await admin
    .from('user_profiles')
    .update({ cms_role: 'partner' })
    .eq('id', userId)
  if (roleErr) throw new Error(`partner cms_role 세팅 실패: ${roleErr.message}`)

  const asPartner = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asPartner.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`ephemeral partner 로그인 실패: ${signInErr.message}`)

  return { client: asPartner, userId }
}

async function createEphemeralVictimId(): Promise<string> {
  const email = `tdd-invrls-victim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral victim 생성 실패: ${error?.message}`)
  const userId = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })
  return userId
}

async function createPendingInvite(createdBy: string): Promise<{ id: string; token: string }> {
  const { data, error } = await admin
    .from('admin_invite_tokens')
    .insert({ created_by: createdBy })
    .select('id, token')
    .single()
  if (error || !data) throw new Error(`invite token 생성 실패: ${error?.message}`)
  cleanups.push(async () => {
    await admin.from('admin_invite_tokens').delete().eq('id', data.id)
  })
  return data
}

describe('[CMS 전역 v6 후속] admin_invite_tokens RLS — partner 등급 접근 차단', () => {
  it('① partner 세션은 다른 계정 앞으로 발급된 대기중 초대 토큰을 조회할 수 없다', async () => {
    const victimId = await createEphemeralVictimId()
    const invite = await createPendingInvite(victimId)
    const { client: asPartner } = await createEphemeralPartnerSession()

    const { data, error } = await asPartner
      .from('admin_invite_tokens')
      .select('id, token')
      .eq('id', invite.id)

    // GREEN 기준: RLS가 막아 빈 배열이거나 에러 — 절대 토큰 원문이 노출되면 안 됨
    expect((data ?? []).length).toBe(0)
    void error
  })

  it('② partner 세션은 대기중 초대 토큰을 UPDATE(선점)할 수 없다', async () => {
    const victimId = await createEphemeralVictimId()
    const invite = await createPendingInvite(victimId)
    const { client: asPartner, userId: partnerId } = await createEphemeralPartnerSession()

    await asPartner
      .from('admin_invite_tokens')
      .update({ used_by: partnerId, used_at: new Date().toISOString() })
      .eq('id', invite.id)

    // service_role로 재조회 — used_at이 여전히 NULL이어야 함(공격자의 UPDATE가 반영 안 됨)
    const { data: after } = await admin
      .from('admin_invite_tokens')
      .select('used_at, used_by')
      .eq('id', invite.id)
      .single()
    expect(after?.used_at).toBeNull()
    expect(after?.used_by).toBeNull()
  })

  it('③ (회귀) service_role 클라이언트는 여전히 초대 토큰을 정상 조회·발급할 수 있다', async () => {
    const victimId = await createEphemeralVictimId()
    const invite = await createPendingInvite(victimId)

    const { data, error } = await admin
      .from('admin_invite_tokens')
      .select('id, token, created_by')
      .eq('id', invite.id)
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe(invite.id)
    expect(data?.created_by).toBe(victimId)
  })
})
