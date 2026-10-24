import { describe, it, expect, vi } from 'vitest'
import { finalizeVerifiedSignup } from '$lib/server/confirmVerifiedSignup'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 가입 마무리(finalizeVerifiedSignup) — 대기 중 이메일을 계정에 확정하고 결과를 검증한다 (2026-10-24)
 * 배경: email_confirm:true만 보내면 '확인 대기' 이메일이 계정에 반영되지 않아 이메일 없는 회원이 생겼다.
 */

function makeAdmin(opts: {
  otpProof?: boolean
  users: Array<{ email?: string | null; new_email?: string | null } | null>   // getUserById 호출 순서별 응답
  updateError?: string
}) {
  const calls: Array<Record<string, unknown>> = []
  let getIdx = 0
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            gte: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: () => Promise.resolve({ data: opts.otpProof === false ? null : { id: 'otp1' } }) }),
              }),
            }),
          }),
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => {
          const u = opts.users[Math.min(getIdx++, opts.users.length - 1)]
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'not found' } }
        }),
        updateUserById: vi.fn(async (_id: string, attrs: Record<string, unknown>) => {
          calls.push(attrs)
          return { error: opts.updateError ? { message: opts.updateError } : null }
        }),
      },
    },
  } as unknown as SupabaseClient
  return { admin, calls }
}

describe('finalizeVerifiedSignup', () => {
  it('휴대폰 인증 기록이 없으면 403 — 아무것도 바꾸지 않는다', async () => {
    const { admin, calls } = makeAdmin({ otpProof: false, users: [{ email: '', new_email: 'a@b.com' }] })
    const r = await finalizeVerifiedSignup(admin, 'u1')
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(calls).toHaveLength(0)
  })

  it('확인 대기 이메일이 있으면 계정 이메일로 직접 확정(email + email_confirm)하고 반영을 확인한다', async () => {
    const { admin, calls } = makeAdmin({ users: [{ email: '', new_email: 'new@b.com' }, { email: 'new@b.com' }] })
    const r = await finalizeVerifiedSignup(admin, 'u1')
    expect(r).toEqual({ ok: true, email: 'new@b.com' })
    expect(calls).toEqual([{ email: 'new@b.com', email_confirm: true }])
  })

  it('이미 계정에 이메일이 있으면 이메일은 건드리지 않고 확인 표시만 한다', async () => {
    const { admin, calls } = makeAdmin({ users: [{ email: 'has@b.com' }, { email: 'has@b.com' }] })
    const r = await finalizeVerifiedSignup(admin, 'u1')
    expect(r).toEqual({ ok: true, email: 'has@b.com' })
    expect(calls).toEqual([{ email_confirm: true }])
  })

  it('계정에도 대기 이메일에도 이메일이 없으면 409(조용히 성공 처리하지 않는다)', async () => {
    const { admin, calls } = makeAdmin({ users: [{ email: '', new_email: '' }] })
    expect(await finalizeVerifiedSignup(admin, 'u1')).toMatchObject({ ok: false, status: 409 })
    expect(calls).toHaveLength(0)
  })

  it('처리 후에도 계정 이메일이 비어 있으면 실패로 돌려준다(결과 검증)', async () => {
    const { admin } = makeAdmin({ users: [{ email: '', new_email: 'new@b.com' }, { email: '' }] })
    expect(await finalizeVerifiedSignup(admin, 'u1')).toMatchObject({ ok: false, status: 500 })
  })

  it('계정 갱신 오류는 500', async () => {
    const { admin } = makeAdmin({ users: [{ email: '', new_email: 'new@b.com' }], updateError: 'boom' })
    expect(await finalizeVerifiedSignup(admin, 'u1')).toMatchObject({ ok: false, status: 500 })
  })

  it('계정을 찾을 수 없으면 404', async () => {
    const { admin } = makeAdmin({ users: [null] })
    expect(await finalizeVerifiedSignup(admin, 'u1')).toMatchObject({ ok: false, status: 404 })
  })
})
