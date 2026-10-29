import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 인증 완료(complete) — 대기 목록의 구매금액·생년월일·가입 방식을 새 계정에 옮기고,
 * 관리자 메모는 서버 전용 메모 테이블에 옮긴다 (2026-10-29, 1단계)
 * 메모 보관이 실패해도 고객 인증(로그인)은 실패시키지 않는다.
 */
const h = vi.hoisted(() => ({
  profileUpdates: [] as Record<string, unknown>[],
  noteInserts: [] as Record<string, unknown>[],
  calls: [] as string[],
  noteError: false,
  stagingUpdates: [] as Record<string, unknown>[],
  member: null as null | Record<string, unknown>,
}))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost', getSupabaseAnonKey: () => 'anon-key' }))
vi.mock('$lib/server/signupRestriction', () => ({ signupRestrictedMessage: async () => null }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { signInWithPassword: async () => ({ data: { session: {} }, error: null }) } }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: h.member, error: null }),
    from(table: string) {
      const st = { op: 'select' }
      const chain: Record<string, unknown> = {}
      const result = () => {
        h.calls.push(`${table}.${st.op}`)
        if (table === 'legacy_claim_otps' && st.op === 'select') {
          return { data: { id: 'tok', phone: '01012345678', verified_at: new Date(Date.now() - 60_000).toISOString() }, error: null }
        }
        if (table === 'legacy_member_notes' && st.op === 'insert') {
          return { data: null, error: h.noteError ? { message: 'denied' } : null }
        }
        return { data: null, error: null }
      }
      chain.select = () => chain
      chain.update = (p: Record<string, unknown>) => { st.op = 'update'; if (table === 'user_profiles') h.profileUpdates.push(p); if (table === 'legacy_member_staging') h.stagingUpdates.push(p); return chain }
      chain.insert = (p: Record<string, unknown>) => { st.op = 'insert'; if (table === 'legacy_member_notes') h.noteInserts.push(p); return chain }
      chain.delete = () => { st.op = 'delete'; return chain }
      chain.eq = () => chain
      chain.not = () => chain
      chain.is = () => chain
      chain.single = async () => result()
      chain.maybeSingle = async () => result()
      chain.then = (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ng)
      return chain
    },
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
        deleteUser: async () => { h.calls.push('auth.deleteUser'); return { error: null } },
      },
    },
  }),
}))

import { POST } from '../../routes/api/auth/legacy-claim/complete/+server'

const baseMember = {
  staging_id: 'st-1', email: 'a@example.com', name: '홍길동', phone: '01012345678',
  legacy_source: 'kakao', legacy_signup_at: '2026-04-11T10:13:29.000Z', legacy_purchase_count: 2, legacy_imported_at: '2026-10-01T00:00:00Z',
  legacy_purchase_amount: 55963, legacy_memo: '미성년자 고객\n연락 오면 챙겨주기', birth_date: '1990-05-17',
}
const cookies = { getAll: () => [], set: () => undefined }
const call = () =>
  POST({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify({ token: 'tok', name: '홍길동', phone: '01012345678' }) }), cookies } as never)

beforeEach(() => {
  h.profileUpdates.length = 0
  h.noteInserts.length = 0
  h.stagingUpdates.length = 0
  h.calls.length = 0
  h.noteError = false
  h.member = { ...baseMember }
})

describe('complete — 레거시 부가 정보 이전', () => {
  it('프로필에 구매금액·가입 방식·생년월일을 옮긴다', async () => {
    const res = await call()
    expect((await res.json()).ok).toBe(true)
    expect(h.profileUpdates).toHaveLength(1)
    expect(h.profileUpdates[0]).toMatchObject({
      legacy_source: 'kakao',
      legacy_purchase_count: 2,
      legacy_purchase_amount: 55963,
      birth_date: '1990-05-17',
    })
  })

  it('생년월일이 없으면 프로필의 생년월일 칸을 건드리지 않는다', async () => {
    h.member = { ...baseMember, birth_date: null }
    await call()
    expect('birth_date' in h.profileUpdates[0]).toBe(false)
  })

  it('관리자 메모는 서버 전용 메모 테이블에 새 계정과 연결해 저장하고, 프로필에는 넣지 않는다', async () => {
    await call()
    expect(h.noteInserts).toHaveLength(1)
    expect(h.noteInserts[0]).toMatchObject({ user_id: 'u-1', memo: '미성년자 고객\n연락 오면 챙겨주기', source: 'kakao' })
    expect('legacy_memo' in h.profileUpdates[0]).toBe(false)
    expect('memo' in h.profileUpdates[0]).toBe(false)
  })

  it('메모가 없으면 메모 테이블에 저장하지 않는다', async () => {
    h.member = { ...baseMember, legacy_memo: null }
    await call()
    expect(h.noteInserts).toHaveLength(0)
    h.member = { ...baseMember, legacy_memo: '   ' }
    await call()
    expect(h.noteInserts).toHaveLength(0)
  })

  it('메모 저장이 실패해도 인증은 성공하고 계정을 되돌리지 않는다', async () => {
    h.noteError = true
    const res = await call()
    expect((await res.json()).ok).toBe(true)
    expect(h.calls).not.toContain('auth.deleteUser')
  })

  it('메모 저장이 실패하면 메모 원본이 있는 대기 행을 지우지 않고 인증 완료로만 표시해 수동 복구할 수 있게 보존한다', async () => {
    h.noteError = true
    await call()
    expect(h.calls).not.toContain('legacy_member_staging.delete')
    expect(h.calls).toContain('legacy_member_staging.update')
    expect(h.stagingUpdates[0]).toHaveProperty('claimed_at')
  })

  it('메모 저장이 성공하면 대기 행은 정상 삭제된다', async () => {
    await call()
    expect(h.calls).toContain('legacy_member_staging.delete')
    expect(h.calls).not.toContain('legacy_member_staging.update')
  })

  it('구매금액 값이 없는 옛 대기 행(이전 마이그레이션 전)도 0 으로 처리한다', async () => {
    const legacy: Record<string, unknown> = { ...baseMember }
    delete legacy.legacy_purchase_amount
    h.member = legacy
    const res = await call()
    expect((await res.json()).ok).toBe(true)
    expect(h.profileUpdates[0].legacy_purchase_amount).toBe(0)
  })
})
