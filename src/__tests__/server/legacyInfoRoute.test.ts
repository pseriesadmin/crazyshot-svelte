/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * GET /api/cms/customers/[id]/legacy-info — CMS 고객 상세의 "이전 서비스 정보"(구매횟수·구매금액·가입 방식·관리자 메모)
 * 메모는 서버 전용 테이블에 있으므로 이 API(고객목록 메뉴 + manager 이상)로만 읽는다.
 */
const h = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  notes: [] as Record<string, unknown>[],
  gate: null as null | Response,
  role: 'manager' as string | null,
}))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => h.gate }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => h.role }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = async () => ({ data: h.notes, error: null })
      chain.maybeSingle = async () => ({ data: table === 'user_profiles' ? h.profile : null, error: null })
      return chain
    },
  }),
}))

import { GET } from '../../routes/api/cms/customers/[id]/legacy-info/+server'

const UID = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
const call = (id = UID, session: unknown = { user: { id: 'admin' } }) =>
  GET({ params: { id }, locals: { safeGetSession: async () => ({ session }) } } as never) as Promise<Response>

beforeEach(() => {
  h.gate = null
  h.role = 'manager'
  h.profile = {
    legacy_claimed_at: '2026-10-05T00:00:00Z', legacy_source: 'kakao', legacy_signup_at: '2026-04-11T10:13:29Z',
    legacy_purchase_count: 2, legacy_purchase_amount: 55963,
  }
  h.notes = [{ memo: '미성년자 고객', created_at: '2026-10-05T00:00:00Z' }]
})

describe('legacy-info API', () => {
  it('이전 회원은 이전 서비스 정보와 메모를 돌려준다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).info).toEqual({
      legacy_source: 'kakao',
      legacy_signup_at: '2026-04-11T10:13:29Z',
      legacy_purchase_count: 2,
      legacy_purchase_amount: 55963,
      memos: [{ memo: '미성년자 고객', created_at: '2026-10-05T00:00:00Z' }],
    })
  })

  it('이전 인증으로 만든 계정이 아니면 info 는 null', async () => {
    h.profile = { legacy_claimed_at: null }
    expect((await (await call()).json()).info).toBeNull()
    h.profile = null
    expect((await (await call()).json()).info).toBeNull()
  })

  it('메뉴 권한 거부는 그대로 반환, 세션 없음 401, manager 미만 403, 잘못된 ID 400', async () => {
    h.gate = new Response('{}', { status: 403 })
    expect((await call()).status).toBe(403)
    h.gate = null
    expect((await call(UID, null)).status).toBe(401)
    h.role = 'partner'
    expect((await call()).status).toBe(403)
    h.role = 'manager'
    expect((await call('../x')).status).toBe(400)
  })

  it('고객목록 메뉴 게이트가 걸려 있고 매핑표에 등록돼 있다', () => {
    const src = readFileSync(join(process.cwd(), 'src/routes/api/cms/customers/[id]/legacy-info/+server.ts'), 'utf-8')
    expect(src).toContain("requireMenuAccessApi(locals, 'customers.list')")
    const map = readFileSync(join(process.cwd(), 'src/lib/server/menuAccessMap.ts'), 'utf-8')
    expect(map).toContain("'src/routes/api/cms/customers/[id]/legacy-info'")
  })
})
