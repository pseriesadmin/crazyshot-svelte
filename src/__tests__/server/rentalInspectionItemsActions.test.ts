import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cms/set/rental 반납 검수 항목 등록(Migration #738) 서버 액션 — 2026-10-22
 *  - manager 이상만 / 항목명 1~100자 서버 검증 / 활성 20개 상한(RPC 응답 매핑) / 순서 변경 입력 검증
 *  - load 는 조회 실패여도 화면 전체를 막지 않는다(inspectionReady=false)
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('$lib/server/holidaySync', () => ({ syncNationalHolidays: vi.fn() }))
vi.mock('$lib/server/dhero', () => ({ validateAddress: vi.fn() }))
vi.mock('$lib/utils/cmsPermissions', () => ({
  hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role),
}))

const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: () => mockRole() }))

const mockRpc = vi.fn()
let selectResult: { data: unknown; error: { message: string } | null } = { data: [], error: null }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'is', 'order', 'limit', 'single', 'gte', 'eq']) chain[m] = () => chain
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve(selectResult).then(r)
      return chain
    },
  }),
}))

import { actions, load } from '../../routes/cms/set/rental/+page.server'

function call(name: 'addInspectionItem' | 'updateInspectionItem' | 'deleteInspectionItem' | 'reorderInspectionItems', fields: Record<string, string>, role = 'manager') {
  mockRole.mockResolvedValue(role)
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin-1' } } }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (actions[name] as any)({ request: { formData: async () => fd }, locals })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
  selectResult = { data: [], error: null }
})

describe('addInspectionItem', () => {
  it('partner 는 403, RPC 미호출', async () => {
    const r = await call('addInspectionItem', { label: '항목' }, 'partner')
    expect(r.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('빈 항목명은 400', async () => {
    expect((await call('addInspectionItem', { label: '   ' })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('100자 초과는 400, 100자는 통과', async () => {
    expect((await call('addInspectionItem', { label: '가'.repeat(101) })).status).toBe(400)
    expect((await call('addInspectionItem', { label: '가'.repeat(100) })).success).toBe(true)
  })
  it('정상 추가 — 항목명 trim·고객검수 값 전달(기본 켜짐)', async () => {
    const r = await call('addInspectionItem', { label: '  케이스 포함  ' })
    expect(r.success).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('cms_upsert_return_inspection_item', { p_id: null, p_label: '케이스 포함', p_customer_visible: true })
    await call('addInspectionItem', { label: '관리자만', customer_visible: 'false' })
    expect(mockRpc).toHaveBeenLastCalledWith('cms_upsert_return_inspection_item', { p_id: null, p_label: '관리자만', p_customer_visible: false })
  })
  it('20개 상한(limit_reached)은 400 + 안내 문구', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'limit_reached' }, error: null })
    const r = await call('addInspectionItem', { label: '항목' })
    expect(r.status).toBe(400)
    expect(String(r.data.error)).toContain('20개')
  })
})

describe('updateInspectionItem', () => {
  it('항목명만 / 고객검수만 따로 수정(넘어온 값만 전달)', async () => {
    await call('updateInspectionItem', { id: 'i1', label: ' 새 이름 ' })
    expect(mockRpc).toHaveBeenLastCalledWith('cms_upsert_return_inspection_item', { p_id: 'i1', p_label: '새 이름', p_customer_visible: null })
    await call('updateInspectionItem', { id: 'i1', customer_visible: 'false' })
    expect(mockRpc).toHaveBeenLastCalledWith('cms_upsert_return_inspection_item', { p_id: 'i1', p_label: null, p_customer_visible: false })
  })
  it('id 없음·변경 내용 없음·빈 이름·긴 이름은 400', async () => {
    expect((await call('updateInspectionItem', { label: 'x' })).status).toBe(400)
    expect((await call('updateInspectionItem', { id: 'i1' })).status).toBe(400)
    expect((await call('updateInspectionItem', { id: 'i1', label: '  ' })).status).toBe(400)
    expect((await call('updateInspectionItem', { id: 'i1', label: '가'.repeat(101) })).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('deleteInspectionItem / reorderInspectionItems', () => {
  it('삭제 — partner 403, manager 는 RPC 호출, 없는 항목은 400', async () => {
    expect((await call('deleteInspectionItem', { id: 'i1' }, 'partner')).status).toBe(403)
    expect((await call('deleteInspectionItem', { id: 'i1' })).success).toBe(true)
    expect(mockRpc).toHaveBeenLastCalledWith('cms_delete_return_inspection_item', { p_id: 'i1' })
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'not_found' }, error: null })
    expect((await call('deleteInspectionItem', { id: 'zz' })).status).toBe(400)
  })
  it('순서 변경 — uuid 문자열 배열만 허용', async () => {
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    expect((await call('reorderInspectionItems', { ids: JSON.stringify([a, b]) })).success).toBe(true)
    expect(mockRpc).toHaveBeenLastCalledWith('cms_reorder_return_inspection_items', { p_ids: [a, b] })
    expect((await call('reorderInspectionItems', { ids: JSON.stringify(['a', 'b']) })).status).toBe(400)
    expect((await call('reorderInspectionItems', { ids: '{bad' })).status).toBe(400)
    expect((await call('reorderInspectionItems', { ids: JSON.stringify([1, 2]) })).status).toBe(400)
  })
})

describe('load — 검수 항목 조회 fail-soft', () => {
  it('조회 오류여도 화면은 렌더링되고 inspectionReady=false', async () => {
    selectResult = { data: null, error: { message: 'relation does not exist' } }
    const res = (await (load as unknown as (e: unknown) => Promise<{ inspectionItems: unknown[]; inspectionReady: boolean }>)({
      locals: { supabase: { from: () => { const c: Record<string, unknown> = {}; for (const m of ['select', 'is', 'order', 'limit', 'single', 'gte', 'eq']) c[m] = () => c; c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r); return c }, rpc: async () => ({ data: [], error: null }) } },
    }))
    expect(res.inspectionReady).toBe(false)
    expect(res.inspectionItems).toEqual([])
  })
})
