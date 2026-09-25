import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 1) direct-send: 6개월 경과(만료) 증명이면 등록 목록·승인·스토리지 원본 삭제 후 카드 발송,
 *    유효/미등록/등록일 없음이면 아무것도 삭제하지 않음
 * 2) revoke-doc-approval: manager+ 만, *_approved_at 만 NULL 처리
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))

const roleRef: { role: string | null } = { role: 'manager' }
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => roleRef.role }))

const PREFIX = 'https://test.supabase.co/storage/v1/object/public/user-documents/'
const profileRow: Record<string, unknown> = {}
const updates: Record<string, unknown>[] = []
const removed: string[][] = []
const inserted: Record<string, unknown>[] = []
const failCardInsert = { on: false }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const ctx: { op: string; table: string } = { op: 'select', table }
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          ctx.op === 'insert' && failCardInsert.on
            ? { data: null, error: { message: 'insert failed' } }
            : { data: { id: 's1', user_id: 'user-1', status: 'open' }, error: null },
        maybeSingle: async () => ({ data: profileRow, error: null }),
        update: (v: Record<string, unknown>) => { ctx.op = 'update'; if (table === 'user_profiles') updates.push(v); return chain },
        insert: (v: Record<string, unknown>) => { ctx.op = 'insert'; inserted.push(v); return chain },
        then: (res: (v: unknown) => unknown) =>
          res({ data: table === 'user_profiles' && ctx.op === 'update' ? [{ user_id: 'user-1' }] : null, error: null }),
      })
      return chain
    },
    storage: { from: () => ({ remove: async (p: string[]) => { removed.push(p); return { error: null } } }) },
  }),
}))

function monthsAgo(n: number): string { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString() }
const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin' } } }) } as never
function req(body: unknown): Request {
  return new Request('https://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  updates.length = 0; removed.length = 0; inserted.length = 0
  for (const k of Object.keys(profileRow)) delete profileRow[k]
  roleRef.role = 'manager'
  failCardInsert.on = false
})

describe('direct-send — 만료 증명 자동 삭제', () => {
  it('본인증명 7개월 경과 → 목록·승인 초기화 + 스토리지 삭제 + 카드 발송', async () => {
    Object.assign(profileRow, {
      identity_doc_url: [`${PREFIX}user-1/a.pdf`, `${PREFIX}user-1/b.pdf`, `${PREFIX}other/c.pdf`],
      identity_verified_at: monthsAgo(7),
    })
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    const res = await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)
    const json = await res.json()
    expect(json.deleted_count).toBe(3)
    const reset = updates.find((u) => 'identity_doc_url' in u)!
    expect(reset).toMatchObject({ identity_doc_url: null, identity_verified_at: null, identity_approved_at: null })
    expect(removed[0]).toEqual(['user-1/a.pdf', 'user-1/b.pdf']) // 다른 고객 폴더 파일은 제외
    expect(inserted.some((m) => m.message_type === 'action_card')).toBe(true)
  })

  it('외국인증명 만료 → foreign 컬럼 전체 초기화', async () => {
    Object.assign(profileRow, { foreign_doc_urls: [`${PREFIX}user-1/f.pdf`], foreign_verified_at: monthsAgo(8) })
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    const json = await (await POST({ request: req({ session_id: 's1', doc_type: 'foreign' }), locals } as never)).json()
    expect(json.deleted_count).toBe(1)
    expect(updates.find((u) => 'foreign_doc_urls' in u)).toMatchObject({
      foreign_doc_urls: null, foreign_verified_at: null, foreign_approved_at: null, is_foreign: false,
    })
  })

  it('6개월 이내(유효) → 삭제 없음, 카드만 발송', async () => {
    Object.assign(profileRow, { identity_doc_url: [`${PREFIX}user-1/a.pdf`], identity_verified_at: monthsAgo(1) })
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    const json = await (await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)).json()
    expect(json.deleted_count).toBe(0)
    expect(removed).toHaveLength(0)
    expect(updates.some((u) => 'identity_doc_url' in u)).toBe(false)
    expect(inserted.some((m) => m.message_type === 'action_card')).toBe(true)
  })

  it('등록일 없음(만료 판정 불가) / 미등록 → 삭제 없음', async () => {
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    Object.assign(profileRow, { identity_doc_url: [`${PREFIX}user-1/a.pdf`], identity_verified_at: null })
    expect((await (await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)).json()).deleted_count).toBe(0)
    Object.assign(profileRow, { identity_doc_url: null, identity_verified_at: null })
    expect((await (await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)).json()).deleted_count).toBe(0)
    expect(removed).toHaveLength(0)
  })
})

describe('direct-send — 삭제 권한(manager 이상)', () => {
  it('partner → 카드는 발송하되 만료 증명이어도 삭제하지 않음', async () => {
    roleRef.role = 'partner'
    Object.assign(profileRow, { identity_doc_url: [`${PREFIX}user-1/a.pdf`], identity_verified_at: monthsAgo(7) })
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    const json = await (await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)).json()
    expect(json.ok).toBe(true)
    expect(json.deleted_count).toBe(0)
    expect(inserted.some((m) => m.message_type === 'action_card')).toBe(true)
    expect(updates.some((u) => 'identity_doc_url' in u)).toBe(false)
    expect(removed).toHaveLength(0)
  })
})

describe('direct-send — 삭제 순서(카드 저장 성공 후 삭제)', () => {
  it('카드 INSERT 실패 → 500, 만료 증명이어도 아무것도 삭제하지 않음', async () => {
    Object.assign(profileRow, { identity_doc_url: [`${PREFIX}user-1/a.pdf`], identity_verified_at: monthsAgo(7) })
    failCardInsert.on = true
    const { POST } = await import('../../routes/api/cms/chat/identity-request/direct-send/+server')
    const res = await POST({ request: req({ session_id: 's1', doc_type: 'identity' }), locals } as never)
    expect(res.status).toBe(500)
    expect(updates.some((u) => 'identity_doc_url' in u)).toBe(false)
    expect(removed).toHaveLength(0)
  })
})

describe('revoke-doc-approval', () => {
  it('manager → *_approved_at 만 NULL', async () => {
    const { POST } = await import('../../routes/api/cms/revoke-doc-approval/+server')
    const json = await (await POST({ request: req({ user_id: 'user-1', type: 'identity' }), locals } as never)).json()
    expect(json.ok).toBe(true)
    expect(updates).toEqual([{ identity_approved_at: null }])
  })

  it('partner(등급 부족) → 403, 변경 없음', async () => {
    roleRef.role = 'partner'
    const { POST } = await import('../../routes/api/cms/revoke-doc-approval/+server')
    const res = await POST({ request: req({ user_id: 'user-1', type: 'identity' }), locals } as never)
    expect(res.status).toBe(403)
    expect(updates).toHaveLength(0)
  })
})
