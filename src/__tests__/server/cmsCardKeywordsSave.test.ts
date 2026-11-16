import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test-project.supabase.co' }))
const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClientMock(...args) }))

const { actions } = await import('../../routes/cms/products/+page.server')

/** updateSection(content) — 카드 노출 키워드는 서버가 등록 키워드의 부분집합(최대 3개)으로 강제하고, 자식 재고 저장은 차단한다 */
function makeAdmin(parentProductId: string | null) {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn().mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { parent_product_id: parentProductId }, error: null }) }) }),
    update: (row: Record<string, unknown>) => { updates.push(row); return { eq: async () => ({ error: null }) } },
  }))
  return { from, updates }
}
function req(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return { formData: async () => fd } as Request
}
const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin' } } }) }
async function save(admin: ReturnType<typeof makeAdmin>, keywords: unknown, card: unknown) {
  createClientMock.mockReturnValue(admin)
  return actions.updateSection({
    request: req({ product_id: 'p1', section_type: 'content', content_blocks: '[]', keywords: JSON.stringify(keywords), card_keywords: JSON.stringify(card) }),
    locals,
  } as Parameters<typeof actions.updateSection>[0])
}

beforeEach(() => createClientMock.mockReset())

describe('updateSection(content) — 카드 노출 키워드 검증', () => {
  it('미등록 키워드·중복·4개째 이후는 걸러내고 순서를 보존해 저장한다', async () => {
    const admin = makeAdmin(null)
    await save(admin, ['a', 'b', 'c', 'd'], ['b', 'x', 'b', 'a', 'c', 'd'])
    expect(admin.updates[0]).toMatchObject({ keywords: ['a', 'b', 'c', 'd'], card_keywords: ['b', 'a', 'c'] })
  })

  it('키워드에서 빠진 값은 카드 노출 선택에서도 사라진다', async () => {
    const admin = makeAdmin(null)
    await save(admin, ['a'], ['a', 'removed'])
    expect(admin.updates[0]).toMatchObject({ card_keywords: ['a'] })
  })

  it('카드 노출 값이 깨진 JSON 이면 빈 배열로 저장한다', async () => {
    const admin = makeAdmin(null)
    createClientMock.mockReturnValue(admin)
    await actions.updateSection({
      request: req({ product_id: 'p1', section_type: 'content', content_blocks: '[]', keywords: '["a"]', card_keywords: '{bad' }),
      locals,
    } as Parameters<typeof actions.updateSection>[0])
    expect(admin.updates[0]).toMatchObject({ card_keywords: [] })
  })

  it('자식 재고에는 저장하지 않는다(400, update 없음)', async () => {
    const admin = makeAdmin('parent-id')
    const result = await save(admin, ['a'], ['a'])
    expect(result).toMatchObject({ status: 400 })
    expect(admin.updates).toHaveLength(0)
  })
})
