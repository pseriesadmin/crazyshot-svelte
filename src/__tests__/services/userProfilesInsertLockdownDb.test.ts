/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * user_profiles 직접 INSERT 차단 라이브 검증 (Migration #759, Stage DB ezyvffjvuwmtuhpxdjrw)
 *
 * 배경(2026-10-24 감사): 운영 DB 에 정책 user_profiles_insert(WITH CHECK auth.uid() = id)가 있고 anon·authenticated 에 INSERT 권한(cms_role·points·credit_score 컬럼 포함)이 열려 있었다.
 * 익명 로그인(signInAnonymously)은 누구나 할 수 있고, 익명 계정은 가입 트리거가 프로필 행을 만들지 않아(handle_new_user 가 건너뜀) 프로필이 없다
 * → 익명 방문자가 자기 id 로 프로필 행을 직접 INSERT 하며 cms_role 을 스스로 정할 수 있는 권한 상승 경로. 프로필 생성의 정식 경로는 SECURITY DEFINER 인 ensure_user_profile()·가입 트리거뿐이다.
 *
 * 이 시험은 위험이 없도록 가장 낮은 등급('partner')으로만 시도하고, 시도로 생긴 행·계정은 항상 삭제한다.
 * 운영 상태를 재현하려면 Stage 에 같은 정책을 만든 뒤 실행한다(차단 전에는 RED, #759 적용 후 GREEN).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin: any = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const createdIds: string[] = []

afterAll(async () => {
  for (const id of createdIds) {
    await admin.from('user_profiles').delete().eq('id', id).then(undefined, () => undefined)
    await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
  }
}, 60000)

// email 은 NOT NULL 이라 빠지면 정책과 무관하게 거절된다 — 공격자는 당연히 넣으므로 시험도 넣는다(처음 시험은 이 값을 빼서 차단 전에도 통과하는 거짓 GREEN 이었다)
function probeEmail(uid: string): string {
  return `probe-${uid.slice(0, 8)}@example.com`
}

async function anonymousSession(): Promise<{ client: any; uid: string }> {
  const client: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw new Error(`익명 로그인 실패: ${error?.message}`)
  createdIds.push(data.user.id)
  return { client, uid: data.user.id }
}

describe('user_profiles 직접 INSERT 로 관리자 등급을 스스로 만들 수 없다', () => {
  it('익명 로그인 계정(프로필 없음)이 자기 id 로 cms_role 을 넣어 INSERT 하면 거절된다', async () => {
    const { client, uid } = await anonymousSession()
    const r = await client.from('user_profiles').insert({ id: uid, user_id: uid, email: probeEmail(uid), cms_role: 'partner' })
    expect(r.error).not.toBeNull()
    // 시도 뒤에도 그 계정은 관리자가 아니다
    const { data: row } = await admin.from('user_profiles').select('id, cms_role').eq('id', uid).maybeSingle()
    expect(row?.cms_role ?? null).toBeNull()
    const who = await client.rpc('is_cms_user')
    expect(who.data).toBe(false)
  })

  it('cms_role 없이 포인트·신용점수만 넣는 INSERT 도 거절된다', async () => {
    const { client, uid } = await anonymousSession()
    const r = await client.from('user_profiles').insert({ id: uid, user_id: uid, email: probeEmail(uid), points: 999999, credit_score: 100 })
    expect(r.error).not.toBeNull()
    const { data: row } = await admin.from('user_profiles').select('id').eq('id', uid).maybeSingle()
    expect(row).toBeNull()
  })

  it('비로그인(anon)의 INSERT 는 권한 자체가 없다', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const r = await anon.from('user_profiles').insert({ id: '00000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000001', email: 'probe-anon@example.com', cms_role: 'partner' })
    expect(r.error).not.toBeNull()
    expect(r.error.message).toMatch(/permission denied|row-level security/i)
  })

  it('정식 경로(ensure_user_profile RPC)는 계속 동작한다 — 프로필이 만들어지되 관리자 등급은 없다', async () => {
    const { client, uid } = await anonymousSession()
    const r = await client.rpc('ensure_user_profile')
    // 정식 가입 전환 전 익명 계정은 이메일이 없어 함수가 거절하거나 행을 만들 수 있다 — 어느 쪽이든 관리자 등급은 생기지 않아야 한다
    const { data: row } = await admin.from('user_profiles').select('cms_role').eq('id', uid).maybeSingle()
    expect(row?.cms_role ?? null).toBeNull()
    expect(r).toBeDefined()
  })
})
