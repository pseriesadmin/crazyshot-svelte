/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 관리자 등급(cms_role) 이중 방어 라이브 검증 (Migration #766, Stage DB ezyvffjvuwmtuhpxdjrw)
 *
 * 배경(2026-10-24 sp5 SEC-002·SEC-005): 프로필 수정 차단이 표 권한 회수(#289) 한 겹뿐이었고,
 * 임시(익명) 로그인 계정도 "프로필에 cms_role 이 있으면" 관리자로 인정됐다.
 * #766: ① 일반 로그인 역할(anon·authenticated)이 cms_role 을 넣거나 바꾸면 트리거가 거절 ② 남은 수정 정책 삭제
 *       ③ is_cms_user·is_cms_admin·is_cms_manager_or_above 가 임시 로그인 계정을 관리자로 인정하지 않음.
 * 이 시험이 확인하는 것: 임시 로그인 계정은 프로필에 cms_role 이 들어가 있어도 관리자 판정이 거짓, 실제 관리자는 그대로 인정, 서버(service_role) 변경 경로는 무영향.
 * (트리거 자체의 authenticated 거절은 표 권한이 막혀 있어 supabase-js 로 닿을 수 없다 — Stage SQL 직접 검증 기록은 TASK.md 참고.)
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

async function anonymousWithRole(role: 'partner' | 'manager'): Promise<{ client: any; uid: string }> {
  const client: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw new Error(`익명 로그인 실패: ${error?.message}`)
  const uid = data.user.id
  createdIds.push(uid)
  // 서버(service_role) 경로로 프로필+등급을 넣는다 — 방어가 서버 경로를 막지 않는지도 함께 확인된다
  const ins = await admin.from('user_profiles').insert({ id: uid, user_id: uid, email: `probe-${uid.slice(0, 8)}@example.com`, cms_role: role })
  if (ins.error) throw new Error(`서버 경로 프로필 생성 실패: ${ins.error.message}`)
  return { client, uid }
}

async function realUserWithRole(role: 'partner' | 'manager'): Promise<{ client: any; uid: string }> {
  const email = `probe-guard-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = `Pw!${Math.random().toString(36).slice(2)}A1`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`계정 생성 실패: ${error?.message}`)
  const uid = data.user.id
  createdIds.push(uid)
  // 가입 트리거가 프로필을 만든다 — 없으면 서버 경로로 보충
  const up = await admin.from('user_profiles').update({ cms_role: role }).eq('id', uid).select('id')
  if (up.error) throw new Error(`서버 경로 등급 부여 실패: ${up.error.message}`)
  if (!up.data?.length) {
    const ins = await admin.from('user_profiles').insert({ id: uid, user_id: uid, email, cms_role: role })
    if (ins.error) throw new Error(`서버 경로 프로필 생성 실패: ${ins.error.message}`)
  }
  const client: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(`로그인 실패: ${login.error.message}`)
  return { client, uid }
}

describe('임시(익명) 로그인 계정은 프로필에 cms_role 이 있어도 관리자로 인정되지 않는다', () => {
  it('is_cms_user · is_cms_admin · is_cms_manager_or_above 모두 거짓', async () => {
    const { client } = await anonymousWithRole('manager')
    expect((await client.rpc('is_cms_user')).data).toBe(false)
    expect((await client.rpc('is_cms_admin')).data).toBe(false)
    expect((await client.rpc('is_cms_manager_or_above')).data).toBe(false)
  })

})

describe('실제(정식) 관리자 계정은 그대로 인정된다', () => {
  it('partner 는 is_cms_user·is_cms_admin 참, is_cms_manager_or_above 거짓', async () => {
    const { client } = await realUserWithRole('partner')
    expect((await client.rpc('is_cms_user')).data).toBe(true)
    expect((await client.rpc('is_cms_admin')).data).toBe(true)
    expect((await client.rpc('is_cms_manager_or_above')).data).toBe(false)
  })

  it('manager 는 세 판정 모두 참', async () => {
    const { client } = await realUserWithRole('manager')
    expect((await client.rpc('is_cms_user')).data).toBe(true)
    expect((await client.rpc('is_cms_admin')).data).toBe(true)
    expect((await client.rpc('is_cms_manager_or_above')).data).toBe(true)
  })
})

describe('서버(service_role) 경로는 등급을 계속 바꿀 수 있다', () => {
  it('service_role 이 등급을 올리고 내릴 수 있다', async () => {
    const { uid } = await realUserWithRole('partner')
    const up = await admin.from('user_profiles').update({ cms_role: 'manager' }).eq('id', uid).select('cms_role')
    expect(up.error).toBeNull()
    expect(up.data?.[0]?.cms_role).toBe('manager')
    const down = await admin.from('user_profiles').update({ cms_role: null }).eq('id', uid).select('cms_role')
    expect(down.error).toBeNull()
    expect(down.data?.[0]?.cms_role ?? null).toBeNull()
  })
})
