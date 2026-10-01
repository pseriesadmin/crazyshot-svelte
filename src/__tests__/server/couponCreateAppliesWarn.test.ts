import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 쿠폰 신규 발행(coupon/new create 액션) — "적용 대상" 저장 실패 경고(warn=applies) 분기 테스트
 * (sp3-qa-agent MEDIUM-1 후속, 2026-10-01)
 *
 * ① 대여/판매 한쪽만 선택 + 적용 대상 RPC 실패(error) → redirect URL에 warn=applies
 * ② 적용 대상 RPC가 { ok:false } 반환(예: COUPON_NOT_FOUND) → 동일하게 warn=applies
 * ③ 적용 대상 RPC 성공 → warn 없음
 * ④ 둘 다 적용(기본값) → 적용 대상 RPC 호출 자체가 없고 warn 없음
 * ⑤ 둘 다 false → 서버 거절(400), 쿠폰 생성 RPC 미호출
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))

type RpcReply = { data: unknown; error: { message: string } | null }
const rpcCalls: string[] = []
let appliesReply: RpcReply = { data: { ok: true }, error: null }

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'u1' } } }),
    supabase: {
      rpc: async (name: string): Promise<RpcReply> => {
        rpcCalls.push(name)
        if (name === 'cms_create_coupon') return { data: { ok: true, id: 'coupon-1' }, error: null }
        if (name === 'cms_set_coupon_applies_to') return appliesReply
        return { data: { ok: true }, error: null }
      },
    },
  }
}

function makeRequest(fields: Record<string, string>) {
  const fd = new FormData()
  const base: Record<string, string> = {
    code: 'TESTCODE', type: 'all', discount_type: 'fixed', discount_value: '1000', code_mode: 'manual',
    validity_type: 'unlimited',
  }
  for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v)
  return { formData: async () => fd } as unknown as Request
}

async function runCreate(fields: Record<string, string>): Promise<{ location?: string; fail?: { status: number } }> {
  const { actions } = await import('../../routes/cms/promotion/coupon/new/+page.server')
  const create = actions.create as unknown as (e: { request: Request; locals: ReturnType<typeof makeLocals> }) => Promise<{ status: number }>
  try {
    const r = await create({ request: makeRequest(fields), locals: makeLocals() })
    return { fail: r }
  } catch (e) {
    return { location: (e as { location?: string }).location }
  }
}

describe('쿠폰 발행 — 적용 대상 저장 실패 경고(warn=applies)', () => {
  beforeEach(() => {
    rpcCalls.length = 0
    appliesReply = { data: { ok: true }, error: null }
  })

  it('① 적용 대상 RPC가 에러를 반환하면 warn=applies로 이동한다', async () => {
    appliesReply = { data: null, error: { message: 'boom' } }
    const r = await runCreate({ applies_to_rental: 'true', applies_to_sale: 'false' })
    expect(r.location).toBe('/cms/promotion/coupon?tab=manage&warn=applies')
  })

  it('② 적용 대상 RPC가 ok:false를 반환해도 warn=applies로 이동한다', async () => {
    appliesReply = { data: { ok: false, error: 'COUPON_NOT_FOUND' }, error: null }
    const r = await runCreate({ applies_to_rental: 'false', applies_to_sale: 'true' })
    expect(r.location).toBe('/cms/promotion/coupon?tab=manage&warn=applies')
  })

  it('③ 적용 대상 RPC가 성공하면 warn 없이 이동한다', async () => {
    const r = await runCreate({ applies_to_rental: 'true', applies_to_sale: 'false' })
    expect(r.location).toBe('/cms/promotion/coupon?tab=manage')
    expect(rpcCalls).toContain('cms_set_coupon_applies_to')
  })

  it('④ 둘 다 적용(기본값)이면 적용 대상 RPC를 호출하지 않고 warn도 없다', async () => {
    const r = await runCreate({ applies_to_rental: 'true', applies_to_sale: 'true' })
    expect(r.location).toBe('/cms/promotion/coupon?tab=manage')
    expect(rpcCalls).not.toContain('cms_set_coupon_applies_to')
  })

  it('⑤ 둘 다 false면 400으로 거절하고 쿠폰을 만들지 않는다', async () => {
    const r = await runCreate({ applies_to_rental: 'false', applies_to_sale: 'false' })
    expect(r.fail?.status).toBe(400)
    expect(rpcCalls).not.toContain('cms_create_coupon')
  })
})
