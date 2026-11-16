import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null }))

/**
 * 자식 재고는 복제 원본이 될 수 없다 (2026-11-16, Stephen 정책)
 * 자식 재고의 정보는 전부 부모에 귀속되고 자식 고유 정보는 상품이력뿐이다. 화면은 자식 선택 시 복제 버튼을 숨기지만,
 * 서버도 자식 id 를 원본으로 받으면 어떤 조회·입력도 더 하지 않고 400 으로 거절해야 한다(직접 POST·오래된 화면 방어).
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test-project.supabase.co' }))

const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClientMock(...args) }))

const { actions } = await import('../../routes/cms/products/+page.server')

const CHILD_SOURCE = {
  id: 'child-id', category: 'camera', name: 'Test Camera', slug: 'test-camera', brand: 'Sony',
  product_code: 'CAM-001-001', parent_product_id: 'parent-id', content_blocks: [], keywords: [], card_keywords: [],
}

function makeAdmin() {
  const insert = vi.fn()
  const rpc = vi.fn()
  const from = vi.fn().mockReturnValue({
    select: () => ({ eq: () => ({ is: () => ({ single: async () => ({ data: CHILD_SOURCE, error: null }) }) }) }),
    insert,
  })
  return { from, rpc, insert }
}

function req(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return { formData: async () => fd } as Request
}
const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin' } } }) }

beforeEach(() => createClientMock.mockReset())

describe('cloneProduct — 자식 재고 원본 거절', () => {
  for (const mode of ['new_product', 'add_inventory'] as const) {
    it(`${mode}: 자식 id 를 원본으로 보내면 400, 원본 조회 1회 외에 입력·RPC 없음`, async () => {
      const admin = makeAdmin()
      createClientMock.mockReturnValue(admin)
      const result = await actions.cloneProduct({
        request: req({ source_product_id: 'child-id', mode, count: '1', auto_code: 'true' }),
        locals,
      } as Parameters<typeof actions.cloneProduct>[0])
      expect(result).toMatchObject({ status: 400 })
      expect(admin.from).toHaveBeenCalledTimes(1)
      expect(admin.insert).not.toHaveBeenCalled()
      expect(admin.rpc).not.toHaveBeenCalled()
    })
  }
})
