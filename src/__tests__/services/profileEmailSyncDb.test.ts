import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { findResetTarget } from '$lib/server/passwordResetOtp'

/**
 * 프로필 이메일 동기화 TDD 통합테스트 — Migration #755 + 비밀번호 찾기 계정 이메일 보완 (2026-10-24)
 *  · 계정(auth.users) 이메일이 바뀌면 프로필 이메일이 자동으로 따라온다(트리거)
 *  · 프로필 이메일이 비어 있어도 계정 이메일이 같으면 비밀번호 찾기가 계정을 찾는다
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트.
 */
if (!PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')) throw new Error('이 테스트는 Stage DB 전용입니다')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const rnd = () => Math.random().toString(36).slice(2, 8)

async function createUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  return id
}

async function profileEmail(id: string): Promise<string | null> {
  const { data } = await admin.from('user_profiles').select('email').eq('id', id).maybeSingle()
  return (data as { email: string | null } | null)?.email ?? null
}

describe('계정 이메일 → 프로필 이메일 동기화(트리거 #755)', () => {
  it('S1: 계정 이메일을 바꾸면 프로필 이메일이 같은 값으로 바뀐다', async () => {
    const id = await createUser(`tdd-sync-${Date.now()}-${rnd()}@example.com`)
    const next = `tdd-sync-new-${Date.now()}-${rnd()}@example.com`
    const { error } = await admin.auth.admin.updateUserById(id, { email: next, email_confirm: true })
    expect(error).toBeNull()
    expect(await profileEmail(id)).toBe(next)
  })

  it('S2: 프로필 이메일이 비어 있어도 계정 이메일이 바뀌면 채워진다(가입 마무리 시나리오)', async () => {
    const id = await createUser(`tdd-sync-${Date.now()}-${rnd()}@example.com`)
    await admin.from('user_profiles').update({ email: '' }).eq('id', id)
    expect(await profileEmail(id)).toBe('')
    const next = `tdd-sync-fill-${Date.now()}-${rnd()}@example.com`
    await admin.auth.admin.updateUserById(id, { email: next, email_confirm: true })
    expect(await profileEmail(id)).toBe(next)
  })
})

describe('비밀번호 찾기 — 프로필 이메일이 비어 있어도 계정 이메일로 찾는다', () => {
  it('S3: 프로필 이메일 공란 + 번호 일치 + 계정 이메일 일치 → 계정을 찾는다 / 다른 이메일은 못 찾는다', async () => {
    const email = `tdd-reset-${Date.now()}-${rnd()}@example.com`
    const id = await createUser(email)
    const phone = `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const { error } = await admin.from('user_profiles').update({ email: '', phone }).eq('id', id)
    expect(error).toBeNull()
    expect(await findResetTarget(admin, email, phone)).toEqual({ userId: id })
    expect(await findResetTarget(admin, `other-${email}`, phone)).toBeNull()
  })
})
